import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

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

    const { data, error } = await supabase
      .from('customers')
      .select('customer_id, name_chinese, name_english, phone')
      .or(`customer_id.ilike.%${searchTerm.trim()}%,name_chinese.ilike.%${searchTerm.trim()}%,name_english.ilike.%${searchTerm.trim()}%,phone.ilike.%${searchTerm.trim()}%`)
      .limit(10)

    if (error) {
      console.error('搜尋客戶時發生錯誤')
      return NextResponse.json(
        { success: false, error: '搜尋失敗: ' + error.message },
        { status: 500 }
      )
    }

    const results = (data || []).map((item: any) => ({
      customer_id: item.customer_id,
      name_chinese: item.name_chinese || '',
      name_english: item.name_english || '',
      phone: item.phone || '',
      display: `${item.customer_id} - ${item.name_chinese || item.name_english || '未命名'}`
    }))

    return NextResponse.json({
      success: true,
      data: results
    })

  } catch (error) {
    console.error('客戶搜尋 API 錯誤')
    return NextResponse.json(
      { success: false, error: '伺服器內部錯誤' },
      { status: 500 }
    )
  }
}