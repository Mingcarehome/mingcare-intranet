import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

// 添加 GET 方法用於調試
export async function GET() {
  return NextResponse.json({
    success: true,
    message: '護理人員搜尋 API 運行正常',
    methods: ['POST']
  })
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createSupabaseServerClient()
    const { searchTerm } = await req.json()
    
    if (!searchTerm || typeof searchTerm !== 'string') {
      return NextResponse.json(
        { success: false, error: '搜尋關鍵字無效' },
        { status: 400 }
      )
    }

    if (searchTerm.trim().length < 1) {
      return NextResponse.json({
        success: true,
        data: []
      })
    }

    // 直接查詢 care_staff_profiles 資料表
    const { data, error } = await supabase
      .from('care_staff_profiles')
      .select('name_chinese, name_english, staff_id, phone')
      .or(`name_chinese.ilike.%${searchTerm.trim()}%,name_english.ilike.%${searchTerm.trim()}%,staff_id.ilike.%${searchTerm.trim()}%,phone.ilike.%${searchTerm.trim()}%`)
      .limit(10)

    if (error) {
      console.error('搜尋護理人員錯誤')
      return NextResponse.json(
        { success: false, error: `資料庫錯誤: ${error.message}` },
        { status: 500 }
      )
    }

    const results = (data || []).map(item => ({
      name_chinese: item.name_chinese || '',
      name_english: item.name_english || '',
      staff_id: item.staff_id || '',
      phone: item.phone || ''
    }))

    return NextResponse.json({
      success: true,
      data: results
    })

  } catch (error) {
    console.error('護理人員搜尋 API 錯誤')
    return NextResponse.json(
      { success: false, error: '伺服器錯誤' },
      { status: 500 }
    )
  }
}
