import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabaseServerClient()
    const body = await request.json()
    
    const {
      customer_id,
      care_staff_name,
      service_date,
      start_time,
      end_time,
      service_type,
      service_address,
      hourly_rate,
      service_fee,
      staff_salary,
      phone,
      customer_name,
      service_hours,
      hourly_salary,
      project_category,
      project_manager,
      staff_id,
      // Legacy field names for backward compatibility
      date,
      staff_name,
      staffId,
      start_time1,
      end_time1,
      start_time2,
      end_time2
    } = body

    // Use the correct field names based on what's being sent
    const finalData = {
      service_date: service_date || date,
      care_staff_name: care_staff_name || staff_name,
      start_time: start_time || start_time1,
      end_time: end_time || end_time1,
      staff_salary: staff_salary,
      phone: phone,
      customer_name: customer_name,
      service_hours: service_hours,
      hourly_salary: hourly_salary || hourly_rate,
      project_category: project_category,
      project_manager: project_manager,
      // Additional fields from the new structure
      customer_id: customer_id,
      staff_id: staff_id || staffId,
      service_type: service_type,
      service_address: service_address,
      service_fee: service_fee,
      hourly_rate: hourly_rate
    }

    // Validate required fields
    if (!finalData.service_date || !finalData.care_staff_name || !finalData.customer_name || !finalData.staff_id) {
      const missingFields = []
      if (!finalData.service_date) missingFields.push('服務日期')
      if (!finalData.care_staff_name) missingFields.push('護理人員姓名')
      if (!finalData.customer_name) missingFields.push('客戶姓名')
      if (!finalData.staff_id) missingFields.push('護理人員編號')
      
      return NextResponse.json(
        { success: false, error: `缺少必要欄位: ${missingFields.join(', ')}` },
        { status: 400 }
      )
    }

    // Insert into billing_salary_data table
    const { data, error } = await supabase
      .from('billing_salary_data')
      .insert(finalData)
      .select()

    if (error) {
      console.error('Billing salary database write failed')
      return NextResponse.json(
        { success: false, error: `資料庫錯誤: ${error.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: data[0]
    })

  } catch (error) {
    console.error('Billing salary API error')
    return NextResponse.json(
      { success: false, error: '伺服器錯誤' },
      { status: 500 }
    )
  }
}
