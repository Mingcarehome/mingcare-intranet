'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

interface VoucherRate {
  service_type: string
  service_rate: number
  effective_date: string
}

interface CommissionRate {
  id?: string
  introducer: string
  first_month_commission: number
  subsequent_month_commission: number
  voucher_commission_percentage?: number | null
}

interface ServiceRecord {
  id: string
  customer_id: string
  customer_name: string
  service_date: string
  service_hours: number
  service_fee: number
  project_category: string
  introducer: string
}

interface VoucherCommissionDetail {
  id: string
  customer_id: string
  customer_name: string
  voucher_number: string
  hkid: string
  service_date: string
  service_type: string
  service_hours: number
  voucher_rate: number
  voucher_total: number
  commission_percentage: number
  commission_amount: number
  introducer: string
}

interface VoucherCommissionSummary {
  customer_id: string
  customer_name: string
  voucher_number: string
  service_type: string
  total_hours: number
  voucher_rate: number
  voucher_total: number
  commission_percentage: number
  commission_amount: number
}

export default function VoucherCommissionPage() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [voucherRates, setVoucherRates] = useState<VoucherRate[]>([])
  const [commissionRates, setCommissionRates] = useState<CommissionRate[]>([])
  const [serviceRecords, setServiceRecords] = useState<ServiceRecord[]>([])
  const [selectedIntroducer, setSelectedIntroducer] = useState<string>('all')
  const [introducerList, setIntroducerList] = useState<string[]>([])
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1)
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [summaryData, setSummaryData] = useState<VoucherCommissionSummary[]>([])
  const [detailData, setDetailData] = useState<VoucherCommissionDetail[]>([])
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  // 格式化日期為 YYYY-MM-DD（避免時區問題）
  const formatDateString = (year: number, month: number, day: number): string => {
    const mm = String(month).padStart(2, '0')
    const dd = String(day).padStart(2, '0')
    return `${year}-${mm}-${dd}`
  }

  // 獲取某月的最後一天
  const getLastDayOfMonth = (year: number, month: number): number => {
    // month 是 1-12，new Date(year, month, 0) 會返回上個月的最後一天
    // 所以 new Date(2026, 1, 0) 返回 2026年1月的最後一天 (31)
    return new Date(year, month, 0).getDate()
  }

  // 根據選擇的年月更新日期範圍
  useEffect(() => {
    const lastDay = getLastDayOfMonth(selectedYear, selectedMonth)
    
    setStartDate(formatDateString(selectedYear, selectedMonth, 1))
    setEndDate(formatDateString(selectedYear, selectedMonth, lastDay))
  }, [selectedYear, selectedMonth])

  // 生成年份選項（過去5年到未來1年）
  const yearOptions = () => {
    const currentYear = new Date().getFullYear()
    const years = []
    for (let y = currentYear - 5; y <= currentYear + 1; y++) {
      years.push(y)
    }
    return years
  }

  // 月份選項
  const monthOptions = [
    { value: 1, label: '1月' },
    { value: 2, label: '2月' },
    { value: 3, label: '3月' },
    { value: 4, label: '4月' },
    { value: 5, label: '5月' },
    { value: 6, label: '6月' },
    { value: 7, label: '7月' },
    { value: 8, label: '8月' },
    { value: 9, label: '9月' },
    { value: 10, label: '10月' },
    { value: 11, label: '11月' },
    { value: 12, label: '12月' }
  ]

  useEffect(() => {
    const getUser = async () => {
      const { data: { user }, error } = await supabase.auth.getUser()
      
      if (user) {
        setUser(user)
        await fetchData()
      } else {
        router.push('/')
      }
      setLoading(false)
    }

    getUser()
  }, [router])

  const fetchData = async () => {
    try {
      setError(null)
      
      // 獲取社區券費率
      const { data: rates, error: ratesError } = await supabase
        .from('voucher_rate')
        .select('*')
      
      if (ratesError) throw ratesError
      if (rates) setVoucherRates(rates)

      // 獲取佣金費率
      const { data: commRates, error: commError } = await supabase
        .from('commission_rate_introducer')
        .select('*')
      
      if (commError) throw commError
      if (commRates) {
        setCommissionRates(commRates as CommissionRate[])
        // 過濾出有設定社區券佣金百分比的介紹人
        const validIntroducers = (commRates as CommissionRate[])
          .filter((r: CommissionRate) => r.voucher_commission_percentage && r.voucher_commission_percentage > 0)
          .map((r: CommissionRate) => r.introducer)
        setIntroducerList(validIntroducers)
      }

    } catch (err) {
      console.error('獲取數據失敗:', err)
      setError('獲取數據失敗')
    }
  }

  const calculateCommission = async () => {
    if (!startDate || !endDate) {
      alert('請選擇日期範圍')
      return
    }

    setLoading(true)
    try {
      // 獲取指定日期範圍的服務記錄
      const { data: billing, error: billingError } = await supabase
        .from('billing_salary_data')
        .select(`
          id,
          customer_id,
          customer_name,
          service_date,
          service_hours,
          service_fee,
          project_category,
          service_type
        `)
        .gte('service_date', startDate)
        .lte('service_date', endDate)

      if (billingError) throw billingError

      // 獲取客戶的介紹人信息
      const { data: customers, error: custError } = await supabase
        .from('customer_personal_data')
        .select('customer_id, introducer, voucher_number, hkid')

      if (custError) throw custError

      // 建立客戶->介紹人映射
      const customerIntroducerMap = new Map<string, string>()
      const customerVoucherMap = new Map<string, string>()
      const customerHkidMap = new Map<string, string>()
      customers?.forEach((c: { customer_id: string; introducer: string | null; voucher_number: string | null; hkid: string | null }) => {
        if (c.introducer) {
          customerIntroducerMap.set(c.customer_id, c.introducer)
        }
        if (c.voucher_number) {
          customerVoucherMap.set(c.customer_id, c.voucher_number)
        }
        if (c.hkid) {
          customerHkidMap.set(c.customer_id, c.hkid)
        }
      })

      interface BillingRecord {
        id: string
        customer_id: string
        customer_name: string
        service_date: string
        service_hours: number
        service_fee: number
        project_category: string
        service_type: string
      }

      interface ExtendedBillingRecord extends BillingRecord {
        introducer: string
      }

      // 過濾並計算
      const filteredRecords: ExtendedBillingRecord[] = ((billing || []) as BillingRecord[])
        .map((record: BillingRecord) => ({
          ...record,
          introducer: customerIntroducerMap.get(record.customer_id) || ''
        }))
        .filter((record: ExtendedBillingRecord) => {
          // 過濾掉 MC街客 類型
          const category = record.project_category || ''
          if (category.includes('MC街客')) {
            return false
          }
          return true
        })
        .filter((record: ExtendedBillingRecord) => {
          // 過濾有介紹人且有設定社區券佣金的
          const introducer = record.introducer
          const commRate = commissionRates.find(r => r.introducer === introducer)
          return commRate && commRate.voucher_commission_percentage && commRate.voucher_commission_percentage > 0
        })
        .filter((record: ExtendedBillingRecord) => {
          // 如果選擇了特定介紹人，只顯示該介紹人的
          if (selectedIntroducer !== 'all') {
            return record.introducer === selectedIntroducer
          }
          return true
        })

      // 使用 service_type 欄位匹配社區券費率（根據 effective_date 自動選擇適用費率）
      const getVoucherRate = (serviceType: string, serviceDate?: string): number => {
        // 找出所有匹配的費率，按 effective_date 降序
        const matchedRates = voucherRates
          .filter(v => {
            if (v.service_type === serviceType) return true
            const normalizedServiceType = serviceType.replace(/[⼀-⿿]/g, char => char)
            const normalizedVoucherType = v.service_type.replace(/[⼀-⿿]/g, char => char)
            return normalizedVoucherType.includes(serviceType.substring(0, 2)) || 
                   serviceType.includes(v.service_type.substring(0, 2))
          })
          .sort((a, b) => (b.effective_date || '').localeCompare(a.effective_date || ''))
        
        if (matchedRates.length > 0 && serviceDate) {
          // 找 effective_date <= serviceDate 的最新費率
          const applicable = matchedRates.find(r => r.effective_date <= serviceDate)
          return applicable?.service_rate || matchedRates[matchedRates.length - 1]?.service_rate || 0
        }
        
        if (matchedRates.length > 0) {
          return matchedRates[0]?.service_rate || 0
        }
        
        return 0
      }

      // 創建每筆服務的詳細記錄
      const detailRecords: VoucherCommissionDetail[] = []
      
      filteredRecords.forEach((record: ExtendedBillingRecord) => {
        // 使用 service_type 欄位獲取社區券費率（根據服務日期選擇新舊費率）
        const rate = getVoucherRate(record.service_type || '', record.service_date)
        // 如果沒有匹配的費率，使用實際服務費 / 服務時數
        const effectiveRate = rate > 0 ? rate : (record.service_hours > 0 ? Math.round(record.service_fee / record.service_hours * 100) / 100 : 0)
        
        // 找到介紹人的佣金百分比
        const commRate = commissionRates.find(r => r.introducer === record.introducer)
        const commissionPercentage = commRate?.voucher_commission_percentage || 0
        
        const hours = record.service_hours || 0
        const voucher_total = Math.round(hours * effectiveRate * 100) / 100
        const commission_amount = Math.round(voucher_total * commissionPercentage / 100 * 100) / 100
        
        detailRecords.push({
          id: record.id,
          customer_id: record.customer_id,
          customer_name: record.customer_name || '',
          voucher_number: customerVoucherMap.get(record.customer_id) || '',
          hkid: customerHkidMap.get(record.customer_id) || '',
          service_date: record.service_date,
          service_type: record.service_type || record.project_category || '未分類',
          service_hours: hours,
          voucher_rate: effectiveRate,
          voucher_total: voucher_total,
          commission_percentage: commissionPercentage,
          commission_amount: commission_amount,
          introducer: record.introducer
        })
      })

      // 按客戶編號排序，同一客戶內按日期排序
      detailRecords.sort((a, b) => {
        const customerCompare = a.customer_id.localeCompare(b.customer_id)
        if (customerCompare !== 0) return customerCompare
        return a.service_date.localeCompare(b.service_date)
      })
      
      setDetailData(detailRecords)
      setServiceRecords(filteredRecords)
      
      // 同時計算匯總數據（用於總覽）
      const groupedData = new Map<string, VoucherCommissionSummary>()
      detailRecords.forEach(record => {
        const key = `${record.customer_id}-${record.service_type}-${record.introducer}`
        const existing = groupedData.get(key)
        if (existing) {
          existing.total_hours = Math.round((existing.total_hours + record.service_hours) * 100) / 100
          existing.voucher_total = Math.round((existing.voucher_total + record.voucher_total) * 100) / 100
          existing.commission_amount = Math.round((existing.commission_amount + record.commission_amount) * 100) / 100
        } else {
          groupedData.set(key, {
            customer_id: record.customer_id,
            customer_name: record.customer_name,
            voucher_number: record.voucher_number,
            service_type: record.service_type,
            total_hours: record.service_hours,
            voucher_rate: record.voucher_rate,
            voucher_total: record.voucher_total,
            commission_percentage: record.commission_percentage,
            commission_amount: record.commission_amount
          })
        }
      })
      setSummaryData(Array.from(groupedData.values()))

    } catch (err) {
      console.error('計算失敗:', err)
      setError('計算失敗')
    } finally {
      setLoading(false)
    }
  }

  // 計算總計 - 使用 Math.round 修復浮點數精度問題
  const totalVoucherAmount = Math.round(detailData.reduce((sum, item) => sum + item.voucher_total, 0) * 100) / 100
  const totalCommission = Math.round(detailData.reduce((sum, item) => sum + item.commission_amount, 0) * 100) / 100
  const totalHours = Math.round(detailData.reduce((sum, item) => sum + item.service_hours, 0) * 100) / 100

  // 按介紹人分組詳細記錄
  const groupDetailByIntroducer = () => {
    const groups = new Map<string, VoucherCommissionDetail[]>()
    
    detailData.forEach(record => {
      if (!groups.has(record.introducer)) {
        groups.set(record.introducer, [])
      }
      groups.get(record.introducer)!.push(record)
    })
    
    return groups
  }

  const introducerDetailGroups = groupDetailByIntroducer()

  // 按介紹人分組（舊的匯總用）
  const groupByIntroducer = () => {
    const groups = new Map<string, VoucherCommissionSummary[]>()
    const customerIntroducerMap = new Map<string, string>()
    
    // 從 serviceRecords 建立映射
    serviceRecords.forEach(record => {
      if (record.introducer) {
        customerIntroducerMap.set(record.customer_id, record.introducer)
      }
    })
    
    summaryData.forEach(item => {
      const introducer = customerIntroducerMap.get(item.customer_id) || '未知'
      if (!groups.has(introducer)) {
        groups.set(introducer, [])
      }
      groups.get(introducer)!.push(item)
    })
    
    return groups
  }

  const introducerGroups = groupByIntroducer()

  // PDF 導出功能
  const generatePDF = () => {
    try {
      // 創建打印用的 HTML
      const printContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>社區券介紹人佣金報表</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; font-size: 11px; }
            h1 { text-align: center; font-size: 18px; margin-bottom: 10px; }
            h2 { font-size: 14px; margin: 15px 0 10px 0; color: #333; }
            .info { text-align: center; color: #666; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th, td { border: 1px solid #ddd; padding: 6px; text-align: left; }
            th { background-color: #f5f5f7; font-weight: bold; }
            .text-right { text-align: right; }
            .text-center { text-align: center; }
            .summary-row { background-color: #f0f0f0; font-weight: bold; }
            .total-section { margin-top: 20px; padding: 15px; background: #e8f5e9; border-radius: 8px; }
            .total-section h3 { margin: 0 0 10px 0; }
            .total-row { display: flex; justify-content: space-between; margin: 5px 0; }
            @media print {
              body { margin: 0; }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <h1>明家居家護理服務 - 社區券介紹人佣金報表</h1>
          <div class="info">
            ${selectedYear}年${selectedMonth}月 (${startDate} 至 ${endDate})
            ${selectedIntroducer !== 'all' ? ` | 介紹人：${selectedIntroducer}` : ''}
          </div>
          
          ${Array.from(introducerDetailGroups.entries()).map(([introducer, items]) => {
            const groupTotal = Math.round(items.reduce((sum, item) => sum + item.voucher_total, 0) * 100) / 100
            const groupCommission = Math.round(items.reduce((sum, item) => sum + item.commission_amount, 0) * 100) / 100
            const groupHours = Math.round(items.reduce((sum, item) => sum + item.service_hours, 0) * 100) / 100
            const commRate = commissionRates.find(r => r.introducer === introducer)
            // 按客戶編號排序
            const sortedItems = [...items].sort((a, b) => {
              const customerCompare = a.customer_id.localeCompare(b.customer_id)
              if (customerCompare !== 0) return customerCompare
              return a.service_date.localeCompare(b.service_date)
            })
            
            // 按客戶分組
            const customerGroups = new Map<string, typeof sortedItems>()
            sortedItems.forEach(item => {
              const key = item.customer_id
              if (!customerGroups.has(key)) {
                customerGroups.set(key, [])
              }
              customerGroups.get(key)!.push(item)
            })
            
            // 生成表格行（包含客戶小結）
            let tableRows = ''
            customerGroups.forEach((customerItems, customerId) => {
              // 添加該客戶的所有記錄
              customerItems.forEach(item => {
                tableRows += `
                  <tr>
                    <td>${item.customer_name}</td>
                    <td>${item.voucher_number || '-'}</td>
                    <td>${item.service_date}</td>
                    <td>${item.service_type}</td>
                    <td class="text-right">${item.service_hours.toFixed(1)}</td>
                    <td class="text-right">$${item.voucher_rate}</td>
                    <td class="text-right">$${item.voucher_total.toLocaleString()}</td>
                    <td class="text-right">$${item.commission_amount.toLocaleString()}</td>
                  </tr>
                `
              })
              // 添加客戶小結
              const customerTotalHours = Math.round(customerItems.reduce((sum, i) => sum + i.service_hours, 0) * 100) / 100
              const customerTotalVoucher = Math.round(customerItems.reduce((sum, i) => sum + i.voucher_total, 0) * 100) / 100
              const customerTotalCommission = Math.round(customerItems.reduce((sum, i) => sum + i.commission_amount, 0) * 100) / 100
              tableRows += `
                <tr style="background-color: #f0f0f0; border-top: 2px solid #ccc;">
                  <td colspan="2" style="font-weight: 500;">${customerItems[0].customer_name} 小結${customerItems[0].hkid ? ` (身份證: ${customerItems[0].hkid})` : ''}</td>
                  <td style="font-size: 10px; color: #666;">${customerItems.length} 次服務</td>
                  <td></td>
                  <td class="text-right" style="font-weight: 500;">${customerTotalHours.toFixed(1)}</td>
                  <td></td>
                  <td class="text-right" style="font-weight: 600; color: #2563eb;">$${customerTotalVoucher.toLocaleString()}</td>
                  <td class="text-right" style="font-weight: 700; color: #16a34a;">$${customerTotalCommission.toLocaleString()}</td>
                </tr>
              `
            })
            
            return `
              <h2>介紹人：${introducer} (佣金比例: ${commRate?.voucher_commission_percentage || 0}%) | 服務次數: ${items.length} | 總時數: ${groupHours.toFixed(1)}h</h2>
              <table>
                <thead>
                  <tr>
                    <th>客戶姓名</th>
                    <th>CCSV 號碼</th>
                    <th>服務日期</th>
                    <th>服務類型</th>
                    <th class="text-right">時數</th>
                    <th class="text-right">費率</th>
                    <th class="text-right">社區券金額</th>
                    <th class="text-right">佣金</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRows}
                  <tr class="summary-row">
                    <td colspan="6">介紹人總計</td>
                    <td class="text-right">$${groupTotal.toLocaleString()}</td>
                    <td class="text-right">$${groupCommission.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            `
          }).join('')}
          
          <div class="total-section">
            <h3>總計</h3>
            <div class="total-row">
              <span>總服務時數：</span>
              <span>${totalHours.toFixed(1)} 小時</span>
            </div>
            <div class="total-row">
              <span>社區券總金額：</span>
              <span>$${totalVoucherAmount.toLocaleString()}</span>
            </div>
            <div class="total-row" style="font-size: 16px; font-weight: bold; color: #2e7d32;">
              <span>應付佣金總額：</span>
              <span>$${totalCommission.toLocaleString()}</span>
            </div>
          </div>
          
          <div style="margin-top: 30px; text-align: center; color: #999; font-size: 10px;">
            生成時間：${new Date().toLocaleString('zh-TW')}
          </div>
        </body>
        </html>
      `

      const printWindow = window.open('', '_blank')
      if (printWindow) {
        printWindow.document.write(printContent)
        printWindow.document.close()
        printWindow.onload = () => {
          printWindow.print()
        }
      }
    } catch (err) {
      console.error('生成 PDF 失敗:', err)
      alert('生成 PDF 失敗')
    }
  }

  const formatCurrency = (amount: number) => {
    return `$${amount.toLocaleString()}`
  }

  if (loading && !user) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <div className="text-center">
          <div className="loading-spinner mx-auto mb-4"></div>
          <p className="text-text-secondary">載入中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Header */}
      <header className="bg-bg-primary/80 backdrop-blur-apple border-b border-border-light sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <button
                onClick={() => router.push('/commissions')}
                className="mr-4 text-text-secondary hover:text-text-primary transition-colors"
              >
                ← 返回
              </button>
              <h1 className="text-xl font-semibold text-text-primary">社區券介紹人佣金報表</h1>
            </div>
            <button
              onClick={() => router.push('/dashboard')}
              className="btn-apple-secondary text-sm"
            >
              返回主頁
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* 篩選條件 */}
        <div className="card-apple mb-6">
          <div className="card-apple-content">
            <h2 className="text-lg font-semibold text-text-primary mb-4">查詢條件</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">年份</label>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="form-input-apple w-full"
                >
                  {yearOptions().map(year => (
                    <option key={year} value={year}>{year}年</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">月份</label>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  className="form-input-apple w-full"
                >
                  {monthOptions.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">介紹人</label>
                <select
                  value={selectedIntroducer}
                  onChange={(e) => setSelectedIntroducer(e.target.value)}
                  className="form-input-apple w-full"
                >
                  <option value="all">全部</option>
                  {introducerList.map(intro => (
                    <option key={intro} value={intro}>{intro}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  onClick={calculateCommission}
                  disabled={loading}
                  className="btn-apple-primary w-full"
                >
                  {loading ? '計算中...' : '計算佣金'}
                </button>
              </div>
              <div className="flex items-end">
                <button
                  onClick={generatePDF}
                  disabled={detailData.length === 0}
                  className="btn-apple-primary w-full bg-green-600 hover:bg-green-700 disabled:opacity-50"
                >
                  📄 導出PDF
                </button>
              </div>
            </div>
            
            {introducerList.length === 0 && (
              <div className="mt-4 p-3 bg-yellow-50 rounded-lg text-sm text-yellow-800">
                <p>⚠️ 目前沒有設定社區券佣金百分比的介紹人。請到「佣金總覽」頁面點擊「⚙️ 佣金設定」設定介紹人的社區券佣金百分比。</p>
              </div>
            )}
          </div>
        </div>

        {/* 總覽統計 */}
        {detailData.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="card-apple">
              <div className="card-apple-content text-center py-4">
                <h3 className="text-sm font-medium text-text-secondary mb-2">總服務時數</h3>
                <p className="text-xl font-bold text-primary">{totalHours.toFixed(1)} 小時</p>
              </div>
            </div>
            <div className="card-apple">
              <div className="card-apple-content text-center py-4">
                <h3 className="text-sm font-medium text-text-secondary mb-2">社區券總金額</h3>
                <p className="text-xl font-bold text-blue-600">{formatCurrency(totalVoucherAmount)}</p>
              </div>
            </div>
            <div className="card-apple">
              <div className="card-apple-content text-center py-4">
                <h3 className="text-sm font-medium text-text-secondary mb-2">應付佣金總額</h3>
                <p className="text-xl font-bold text-mingcare-green">{formatCurrency(totalCommission)}</p>
              </div>
            </div>
            <div className="card-apple">
              <div className="card-apple-content text-center py-4">
                <h3 className="text-sm font-medium text-text-secondary mb-2">服務記錄數</h3>
                <p className="text-xl font-bold text-mingcare-purple">{detailData.length}</p>
              </div>
            </div>
          </div>
        )}

        {/* 按介紹人分組顯示每筆服務記錄 */}
        {Array.from(introducerDetailGroups.entries()).map(([introducer, items]) => {
          const groupTotal = Math.round(items.reduce((sum, item) => sum + item.voucher_total, 0) * 100) / 100
          const groupCommission = Math.round(items.reduce((sum, item) => sum + item.commission_amount, 0) * 100) / 100
          const groupHours = Math.round(items.reduce((sum, item) => sum + item.service_hours, 0) * 100) / 100
          const commRate = commissionRates.find(r => r.introducer === introducer)

          return (
            <div key={introducer} className="card-apple mb-6">
              <div className="bg-bg-secondary px-6 py-4 border-b border-border-light rounded-t-apple">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-lg font-semibold text-text-primary">
                      介紹人：{introducer}
                    </h2>
                    <div className="text-sm text-text-secondary mt-1">
                      <span className="inline-block bg-purple-100 text-purple-800 px-2 py-1 rounded mr-2">
                        佣金比例: {commRate?.voucher_commission_percentage || 0}%
                      </span>
                      <span className="inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded mr-2">
                        服務時數: {groupHours.toFixed(1)}h
                      </span>
                      <span className="inline-block bg-gray-100 text-gray-800 px-2 py-1 rounded">
                        服務次數: {items.length}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-mingcare-green">
                      佣金：{formatCurrency(groupCommission)}
                    </p>
                    <p className="text-sm text-text-secondary">
                      社區券：{formatCurrency(groupTotal)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-bg-secondary">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-text-secondary">客戶姓名</th>
                      <th className="px-4 py-3 text-left font-medium text-text-secondary">服務日期</th>
                      <th className="px-4 py-3 text-left font-medium text-text-secondary">服務類型</th>
                      <th className="px-4 py-3 text-right font-medium text-text-secondary">時數</th>
                      <th className="px-4 py-3 text-right font-medium text-text-secondary">費率</th>
                      <th className="px-4 py-3 text-right font-medium text-text-secondary">社區券金額</th>
                      <th className="px-4 py-3 text-right font-medium text-text-secondary">佣金</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {(() => {
                      // 按客戶分組
                      const sortedItems = items.slice().sort((a, b) => {
                        const customerCompare = a.customer_id.localeCompare(b.customer_id)
                        if (customerCompare !== 0) return customerCompare
                        return a.service_date.localeCompare(b.service_date)
                      })
                      
                      // 分組客戶
                      const customerGroups = new Map<string, typeof sortedItems>()
                      sortedItems.forEach(item => {
                        const key = item.customer_id
                        if (!customerGroups.has(key)) {
                          customerGroups.set(key, [])
                        }
                        customerGroups.get(key)!.push(item)
                      })
                      
                      const rows: React.ReactNode[] = []
                      customerGroups.forEach((customerItems, customerId) => {
                        // 添加該客戶的所有記錄
                        customerItems.forEach((item, index) => {
                          rows.push(
                            <tr key={`${item.id}-${index}`} className="hover:bg-bg-secondary transition-colors">
                              <td className="px-4 py-3 text-text-primary">{item.customer_name}</td>
                              <td className="px-4 py-3 text-text-secondary">{item.service_date}</td>
                              <td className="px-4 py-3 text-text-secondary">{item.service_type}</td>
                              <td className="px-4 py-3 text-right text-text-secondary">{item.service_hours.toFixed(1)}h</td>
                              <td className="px-4 py-3 text-right text-text-secondary">${item.voucher_rate}/h</td>
                              <td className="px-4 py-3 text-right text-blue-600 font-medium">{formatCurrency(item.voucher_total)}</td>
                              <td className="px-4 py-3 text-right text-mingcare-green font-semibold">{formatCurrency(item.commission_amount)}</td>
                            </tr>
                          )
                        })
                        
                        // 添加客戶小結行
                        const customerTotalHours = Math.round(customerItems.reduce((sum, i) => sum + i.service_hours, 0) * 100) / 100
                        const customerTotalVoucher = Math.round(customerItems.reduce((sum, i) => sum + i.voucher_total, 0) * 100) / 100
                        const customerTotalCommission = Math.round(customerItems.reduce((sum, i) => sum + i.commission_amount, 0) * 100) / 100
                        rows.push(
                          <tr key={`subtotal-${customerId}`} className="bg-gray-50 border-t-2 border-gray-200">
                            <td className="px-4 py-2 text-text-primary font-medium">
                              {customerItems[0].customer_name} 小結{customerItems[0].hkid ? ` (身份證: ${customerItems[0].hkid})` : ''}
                            </td>
                            <td className="px-4 py-2 text-text-secondary text-sm">
                              {customerItems.length} 次服務
                            </td>
                            <td className="px-4 py-2"></td>
                            <td className="px-4 py-2 text-right text-text-primary font-medium">{customerTotalHours.toFixed(1)}h</td>
                            <td className="px-4 py-2"></td>
                            <td className="px-4 py-2 text-right text-blue-600 font-semibold">{formatCurrency(customerTotalVoucher)}</td>
                            <td className="px-4 py-2 text-right text-mingcare-green font-bold">{formatCurrency(customerTotalCommission)}</td>
                          </tr>
                        )
                      })
                      
                      return rows
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}

        {/* 無數據提示 */}
        {detailData.length === 0 && !loading && (
          <div className="card-apple">
            <div className="card-apple-content text-center py-12">
              <div className="mx-auto w-16 h-16 bg-bg-tertiary rounded-full flex items-center justify-center mb-4">
                <svg className="h-8 w-8 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-text-primary mb-2">請選擇日期範圍並計算</h3>
              <p className="text-text-secondary">選擇開始和結束日期，然後點擊「計算佣金」按鈕</p>
            </div>
          </div>
        )}

        {error && (
          <div className="card-apple bg-red-50 border-red-200">
            <div className="card-apple-content text-center py-6">
              <p className="text-red-600">{error}</p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
