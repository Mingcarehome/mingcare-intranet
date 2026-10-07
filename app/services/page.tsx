'use client'

import React, { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { getAssetPath } from '../../utils/asset-path'
import { BackToHomeButton } from '../../components/BackToHomeButton'
import LoadingScreen from '../../components/LoadingScreen'
import { CareStaffSearchableSelect } from '../../components/CareStaffSearchableSelect'
import LastUpdateIndicator from '../../components/LastUpdateIndicator'
import CardUpdateIndicator from '../../components/CardUpdateIndicator'
import type {
  BillingSalaryFilters,
  BillingSalaryRecord,
  BillingSalaryRecordWithOvernight,
  BillingSalaryFormData,
  DateRangePreset,
  ServiceType,
  ProjectCategory,
  ProjectManager,
  BusinessKPI,
  ProjectCategorySummary,
  Introducer
} from '../../types/billing-salary'
import {
  SERVICE_TYPE_OPTIONS,
  PROJECT_CATEGORY_OPTIONS,
  PROJECT_MANAGER_OPTIONS,
  INTRODUCER_OPTIONS
} from '../../types/billing-salary'
import { CUSTOMER_TYPE_OPTIONS } from '../../types/customer-management'
import {
  getBusinessKPI,
  getProjectCategorySummary,
  fetchBillingSalaryRecords,
  fetchAllBillingSalaryRecords,
  createBillingSalaryRecord,
  updateBillingSalaryRecord,
  deleteBillingSalaryRecord,
  createMultipleDayRecords,
  exportToCSV,
  getAllCareStaff,
  CustomerSearchResult,
  fetchVoucherRates,
  calculateVoucherSummary,
  VoucherRate,
  getApplicableRate
} from '../../services/billing-salary-management'
import { exportCalendar, CalendarExportOptions } from '../../services/calendar-export'

// =============================================================================
// 2026年香港公眾假期
// =============================================================================
const HK_PUBLIC_HOLIDAYS_2026: { [key: string]: string } = {
  '2026-01-01': '元旦',
  '2026-02-17': '農曆年初一',
  '2026-02-18': '農曆年初二',
  '2026-02-19': '農曆年初三',
  '2026-04-03': '耶穌受難節',
  '2026-04-04': '耶穌受難節翌日',
  '2026-04-06': '清明節翌日',
  '2026-04-07': '復活節星期一翌日',
  '2026-05-01': '勞動節',
  '2026-05-25': '佛誕翌日',
  '2026-06-19': '端午節',
  '2026-07-01': '香港特別行政區成立紀念日',
  '2026-09-26': '中秋節翌日',
  '2026-10-01': '國慶日',
  '2026-10-19': '重陽節翌日',
  '2026-12-25': '聖誕節',
  '2026-12-26': '聖誕節後第一個週日'
}

// 檢查日期是否為公眾假期
const isPublicHoliday = (date: Date): { isHoliday: boolean; name: string | null } => {
  const dateStr = formatDateSafely(date)
  const holidayName = HK_PUBLIC_HOLIDAYS_2026[dateStr]
  // 每個星期日也是公眾假期
  if (date.getDay() === 0) {
    return { isHoliday: true, name: holidayName || '星期日' }
  }
  return { isHoliday: !!holidayName, name: holidayName || null }
}

// =============================================================================
// 日期處理輔助函數
// =============================================================================

/**
 * 安全地从 YYYY-MM-DD 格式字符串解析日期，避免时区问题
 * @param dateString - 格式为 YYYY-MM-DD 的日期字符串
 * @returns Date 对象（本地时间）
 */
function parseDateStringLocal(dateString: string): Date {
  const [year, month, day] = dateString.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * 将 Date 对象格式化为 YYYY-MM-DD 字符串，使用本地时间
 * @param date - Date 对象
 * @returns YYYY-MM-DD 格式的字符串
 */
function formatDateLocal(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// =============================================================================
// 佣金相關類型定義
// =============================================================================

interface CommissionRate {
  introducer: string
  first_month_commission: number
  subsequent_month_commission: number
}

interface CustomerCommissionData {
  customer_id: string
  customer_name: string
  introducer: string
  service_month: string
  monthly_hours: number
  monthly_fee: number
  is_qualified: boolean
  month_sequence: number
  commission_amount: number
  first_service_date: string
}

interface MonthlyCommissionSummary {
  totalCommission: number
  totalQualifiedCustomers: number
  totalCustomers: number
  introducerCount: number
}

// 安全的日期格式化函數 - 避免時區問題
const formatDateSafely = (date: Date): string => {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return new Date().toISOString().split('T')[0] // 返回今日日期作為備選
  }
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// 詳細記錄列表組件
interface DetailedRecordsListProps {
  filters: BillingSalaryFilters
  onRefresh?: () => void  // 添加刷新回調函數
}

// 排序類型
type SortField = 'service_date' | 'customer_name' | 'customer_id'
type SortDirection = 'asc' | 'desc'

interface SortConfig {
  field: SortField
  direction: SortDirection
}

// 報表月曆檢視組件
function ReportsCalendarView({
  filters,
  onEdit,
  onDelete,
  refreshTrigger,
  recordUpdateTimes
}: {
  filters: BillingSalaryFilters;
  onEdit: (record: BillingSalaryRecord) => void;
  onDelete: (recordId: string) => void;
  refreshTrigger?: number;
  recordUpdateTimes?: Record<string, Date>;
}) {
  const [calendarData, setCalendarData] = useState<Record<string, BillingSalaryRecordWithOvernight[]>>({})
  const [loading, setLoading] = useState(true)
  // 從 filters 初始化 currentDate
  const [currentDate, setCurrentDate] = useState(() => {
    if (filters.dateRange?.start) {
      const [year, month] = filters.dateRange.start.split('-').map(Number)
      return new Date(year, month - 1, 1)
    }
    return new Date()
  })
  const [isMobile, setIsMobile] = useState(false)
  const [viewMode, setViewMode] = useState<'calendar' | 'cards'>('cards') // 新增視圖模式狀態，默認為卡片
  const [allRecords, setAllRecords] = useState<BillingSalaryRecord[]>([]) // 存儲所有記錄用於卡片視圖

  // 調試：監控 recordUpdateTimes props 的變化
  useEffect(() => {
    console.log('📅 ReportsCalendarView 收到 recordUpdateTimes:', recordUpdateTimes)
    console.log('📅 recordUpdateTimes 鍵數量:', recordUpdateTimes ? Object.keys(recordUpdateTimes).length : 0)
  }, [recordUpdateTimes])

  // 當 filters 的日期範圍變化時，自動跳轉月曆到對應月份
  useEffect(() => {
    if (filters.dateRange?.start) {
      // 解析日期字串 (格式: YYYY-MM-DD)，避免時區問題
      const [year, month] = filters.dateRange.start.split('-').map(Number)
      console.log('📅 ReportsCalendarView 同步月曆到:', year, month)
      setCurrentDate(new Date(year, month - 1, 1))
    }
  }, [filters.dateRange.start])

  // 監聽螢幕尺寸變化
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 640)
    }

    // 初始化
    handleResize()

    // 監聽 resize 事件
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])
  const [selectedRecord, setSelectedRecord] = useState<BillingSalaryRecord | null>(null)
  const [showRecordMenu, setShowRecordMenu] = useState(false)
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set())

  // 載入月曆數據
  useEffect(() => {
    const loadCalendarData = async () => {
      setLoading(true)
      try {
        const response = await fetchBillingSalaryRecords(filters, 1, 100000) // 獲取所有記錄用於月曆顯示（無上限）

        if (response.success && response.data) {
          const records = response.data.data || []
          setAllRecords(records) // 存儲所有記錄

// 將記錄按日期分組（支援跨夜更）
const groupedByDate: Record<string, BillingSalaryRecordWithOvernight[]> = {}

records.forEach((record: BillingSalaryRecord) => {
  const startDate = record.service_date

  // 先放回原始日期
  if (!groupedByDate[startDate]) {
    groupedByDate[startDate] = []
  }
  groupedByDate[startDate].push(record)

  // 只在真正跨夜時，才生成「隔天」顯示複本
  if (record.start_time && record.end_time && record.start_time > record.end_time) {
    const startDateObj = parseDateStringLocal(startDate)
    startDateObj.setDate(startDateObj.getDate() + 1)
    const endDate = formatDateLocal(startDateObj)

    // 避免時區問題造成 endDate === startDate
    if (endDate !== startDate) {
      if (!groupedByDate[endDate]) {
        groupedByDate[endDate] = []
      }

      const overnightRecord = { ...record, _isOvernightEndDay: true }
      groupedByDate[endDate].push(overnightRecord)
    }
  }
})

// 兜底：避免同一個 record 因為前端邏輯重複插入而重複渲染
Object.keys(groupedByDate).forEach((dateKey) => {
  const seen = new Set<string>()
  groupedByDate[dateKey] = groupedByDate[dateKey].filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
})

          setCalendarData(groupedByDate)
        }
      } catch (error) {
        console.error('載入月曆數據失敗:', error)
      } finally {
        setLoading(false)
      }
    }

    loadCalendarData()
  }, [filters, refreshTrigger])

  // 生成月曆日期
  const generateCalendarDays = () => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const firstDay = new Date(year, month, 1)
    const startDate = new Date(firstDay)
    startDate.setDate(startDate.getDate() - firstDay.getDay()) // 從週日開始

    const days = []
    const current = new Date(startDate)

    // 生成6週的日期（42天）
    for (let i = 0; i < 42; i++) {
      days.push(new Date(current))
      current.setDate(current.getDate() + 1)
    }

    return days
  }

  // 月份導航
  const navigateMonth = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate)
    newDate.setMonth(currentDate.getMonth() + (direction === 'next' ? 1 : -1))
    setCurrentDate(newDate)
  }

  const calendarDays = generateCalendarDays()
  const currentMonth = currentDate.getMonth()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
        <span className="ml-3 text-text-secondary">載入月曆數據中...</span>
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* 月份導航和視圖切換 - 移動端優化 */}
      <div className="flex justify-between items-center px-2 sm:px-0">
        {/* 月份導航 */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => navigateMonth('prev')}
            className="p-2 sm:p-3 rounded-xl border border-border-light hover:bg-bg-secondary transition-all duration-300"
          >
            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <h4 className="text-base sm:text-lg font-medium text-text-primary">
            {currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月
          </h4>

          <button
            onClick={() => navigateMonth('next')}
            className="p-2 sm:p-3 rounded-xl border border-border-light hover:bg-bg-secondary transition-all duration-300"
          >
            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* 視圖切換按鈕 */}
        <div className="flex rounded-xl border border-border-light overflow-hidden bg-bg-secondary/50 backdrop-blur-sm">
          <button
            onClick={() => setViewMode('cards')}
            className={`px-4 py-2.5 text-sm font-medium transition-all duration-300 flex items-center space-x-2 ${
              viewMode === 'cards'
                ? 'bg-primary text-white shadow-lg'
                : 'bg-transparent text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            <span>卡片</span>
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            className={`px-4 py-2.5 text-sm font-medium transition-all duration-300 flex items-center space-x-2 ${
              viewMode === 'calendar'
                ? 'bg-primary text-white shadow-lg'
                : 'bg-transparent text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span>日曆</span>
          </button>
        </div>
      </div>

      {/* 條件渲染不同視圖 */}
      {viewMode === 'calendar' ? (
        <>
          {/* 星期標題 - 移動端優化 */}
          <div className="grid grid-cols-7 gap-0.5 sm:gap-1 mb-2">
            {['日', '一', '二', '三', '四', '五', '六'].map(day => (
              <div key={day} className="p-1 sm:p-2 text-center font-medium text-text-secondary bg-bg-secondary rounded text-xs sm:text-sm">
                {day}
              </div>
            ))}
          </div>

      {/* 月曆網格 - 移動端優化 */}
      <div className="grid grid-cols-7 gap-0.5 sm:gap-1" style={{overflow: 'visible'}}>
        {calendarDays && calendarDays.map((date, index) => {
          const dateStr = formatDateSafely(date)
          const isCurrentMonth = date.getMonth() === currentMonth
          const isToday = dateStr === formatDateSafely(new Date())
          const isWeekend = date.getDay() === 0 || date.getDay() === 6
          const holiday = isPublicHoliday(date)
          const dayRecords = calendarData[dateStr] || []

          // 根據記錄數量動態調整高度 - 移動端小一些
          const baseHeight = isMobile ? 80 : 120
          const additionalHeight = isMobile ? 50 : 80
          const minHeight = dayRecords.length > 0
            ? Math.max(baseHeight, baseHeight + (dayRecords.length - 1) * additionalHeight)
            : baseHeight

          return (
            <div
              key={index}
              style={{ minHeight: `${minHeight}px`, overflow: 'visible' }}
              className={`
                p-1 sm:p-2 border rounded-xl
                ${!isCurrentMonth ? 'bg-bg-secondary text-text-tertiary border-border-light' :
                  holiday.isHoliday ? 'bg-red-50 border-red-300' :
                  isWeekend ? 'bg-blue-50 border-blue-200' : 'bg-bg-primary border-border-light'}
                ${isToday ? 'ring-1 sm:ring-2 ring-primary border-primary' : ''}
              `}
            >
              <div className={`
                text-xs sm:text-sm font-bold mb-1 sm:mb-2 flex items-center gap-1
                ${isToday ? 'text-primary' :
                  holiday.isHoliday ? 'text-red-600' :
                  isCurrentMonth ? 'text-text-primary' : 'text-text-tertiary'}
              `}>
                <span>{date.getDate()}</span>
                {holiday.isHoliday && holiday.name && holiday.name !== '星期日' && (
                  <span className="text-xs text-red-500 truncate hidden sm:inline" title={holiday.name}>
                    {holiday.name.length > 4 ? holiday.name.substring(0, 4) + '..' : holiday.name}
                  </span>
                )}
              </div>

              {/* 服務記錄 - 移動端優化 */}
              {isCurrentMonth && dayRecords.length > 0 && (
                <div className="space-y-0.5 sm:space-y-1" style={{overflow: 'visible'}}>
                  {/* 決定要顯示多少筆記錄 - 移動端顯示較少 */}
                  {(() => {
                    const dateKey = formatDateSafely(date)
                    const isExpanded = expandedDates.has(dateKey)
                    const maxRecords = isMobile ? 2 : 3
                    // 排序：最近30分鐘有更新的記錄優先顯示
                    const sortedDayRecords = [...dayRecords].sort((a, b) => {
                      const aUpdated = recordUpdateTimes?.[a.id]?.getTime() ?? 0
                      const bUpdated = recordUpdateTimes?.[b.id]?.getTime() ?? 0
                      return bUpdated - aUpdated
                    })

                    const recordsToShow = isExpanded ? sortedDayRecords : sortedDayRecords.slice(0, maxRecords)

                    return (recordsToShow || []).map((record, i) => (
                      <div
                        key={`${record.id}-${i}`}
                        onClick={() => {
                          setSelectedRecord(record)
                          setShowRecordMenu(true)
                        }}
                        className={`text-xs sm:text-sm border border-border-light rounded p-1 sm:p-2 shadow-sm cursor-pointer hover:shadow-md hover:border-primary transition-all duration-300 relative overflow-visible ${recordUpdateTimes?.[record.id] ? 'bg-green-50 border-green-300 ring-1 ring-green-400' : 'bg-white'}`}
                        data-updated={recordUpdateTimes?.[record.id] ? 'true' : 'false'}
                      >
                        {/* 方案1: 大字體更新標題 - 保證能看到 */}
                        {(() => {
                          const last = recordUpdateTimes?.[record.id]
                          if (!last) return null
                          const diff = Math.floor((Date.now() - last.getTime()) / 60000)
                          const label = diff < 1 ? '剛剛' : (diff === 1 ? '1分鐘前' : `${diff}分鐘前`)
                          return (
                            <div className="text-center mb-2 bg-green-600 text-white font-bold text-sm py-1 rounded">
                              {label}更新
                            </div>
                          )
                        })()}
                        
                        <div className="font-medium text-text-primary mb-0.5 sm:mb-1 leading-tight text-xs sm:text-sm">
                          <span className="hidden sm:inline">{record.customer_name}/{record.care_staff_name}</span>
                          <span className="sm:hidden">{record.customer_name.substring(0, 6)}/{record.care_staff_name.substring(0, 6)}</span>
                        </div>
                        <div className="text-blue-600 mb-0.5 sm:mb-1 leading-tight text-xs">
                          {record.service_type}
                        </div>
                        <div className="text-text-secondary text-xs flex items-center gap-1">
                          {/* 跨夜更標記 */}
                          {record.start_time && record.end_time && record.start_time > record.end_time && (
                            <span title="跨夜更" className="text-orange-500">🌙</span>
                          )}
                          {/* 隔天顯示標記 */}
                          {(record as any)._isOvernightEndDay && (
                            <span className="text-xs text-orange-600 font-semibold">(隔天)</span>
                          )}
                          {record.start_time}-{record.end_time}
                        </div>
                      </div>
                    ))
                  })()}

                  {/* 展開/收合按鈕 */}
                  {dayRecords.length > 3 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        const dateKey = formatDateSafely(date)
                        const newExpandedDates = new Set(expandedDates)

                        if (expandedDates.has(dateKey)) {
                          newExpandedDates.delete(dateKey)
                        } else {
                          newExpandedDates.add(dateKey)
                        }

                        setExpandedDates(newExpandedDates)
                      }}
                      className="w-full text-sm text-primary hover:text-blue-700 text-center py-1 rounded hover:bg-blue-50 transition-colors"
                    >
                      {expandedDates.has(formatDateSafely(date))
                        ? '收合記錄'
                        : `還有 ${dayRecords.length - 3} 筆記錄...`
                      }
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

        {/* 記錄操作模態框 */}
        {showRecordMenu && selectedRecord && (
          <>
            {/* 背景遮罩 */}
            <div 
              className="fixed inset-0 bg-black/40 z-[9998]"
              onClick={() => {
                setShowRecordMenu(false)
                setSelectedRecord(null)
              }}
            />
            {/* 模態框內容 */}
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none">
              <div 
                className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl pointer-events-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-lg font-semibold text-gray-900 mb-4">選擇操作</h3>

                {/* 記錄詳情 */}
                <div className="bg-gray-50 rounded-xl p-4 mb-5 border border-gray-100">
                  <div className="text-sm text-gray-500 mb-1">
                    {selectedRecord.service_date} {selectedRecord.start_time}-{selectedRecord.end_time}
                  </div>
                  <div className="font-semibold text-gray-900">
                    {selectedRecord.customer_name}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    護理員：{selectedRecord.care_staff_name}
                  </div>
                  <div className="text-sm text-blue-600 font-medium mt-1">
                    {selectedRecord.service_type}
                  </div>
                </div>

                {/* 操作按鈕 */}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      onEdit(selectedRecord)
                      setShowRecordMenu(false)
                      setSelectedRecord(null)
                    }}
                    className="flex-1 py-3 px-4 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 transition-colors"
                  >
                    編輯
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(selectedRecord.id)
                      setShowRecordMenu(false)
                      setSelectedRecord(null)
                    }}
                    className="flex-1 py-3 px-4 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 transition-colors"
                  >
                    刪除
                  </button>
                </div>

                {/* 取消按鈕 */}
                <button
                  type="button"
                  onClick={() => {
                    setShowRecordMenu(false)
                    setSelectedRecord(null)
                  }}
                  className="w-full mt-3 py-3 px-4 text-gray-600 bg-gray-100 rounded-xl font-medium hover:bg-gray-200 transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          </>
        )}
        </>
      ) : (
        /* 卡片視圖 */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {allRecords.map((record, index) => {
            // 🐛 調試：檢查每個記錄的更新時間
            const updateTime = recordUpdateTimes?.[record.id]
            if (updateTime) {
              console.log('🎯 卡片渲染 - 找到記錄更新時間:', {
                recordId: record.id,
                customerName: record.customer_name,
                updateTime: updateTime.toISOString(),
                diffInMinutes: Math.floor((Date.now() - updateTime.getTime()) / 60000)
              })
            }
            
            return (
              <div
                key={record.id}
                onClick={() => {
                  setSelectedRecord(record)
                  setShowRecordMenu(true)
                }}
                className={`card-apple border p-5 shadow-sm cursor-pointer hover:shadow-lg hover:border-primary hover:-translate-y-0.5 transition-all duration-300 relative ${recordUpdateTimes?.[record.id] ? 'bg-green-50 border-green-300 ring-2 ring-green-400/30' : 'border-border-light'}`}
              >
                {/* 30分鐘更新提示 */}
                {(() => {
                  const last = recordUpdateTimes?.[record.id]
                  if (!last) return null
                  const diff = Math.floor((Date.now() - last.getTime()) / 60000)
                  const label = diff < 1 ? '剛剛' : (diff === 1 ? '1分鐘前' : `${diff}分鐘前`)
                  console.log('🎯 渲染30分鐘提示:', { recordId: record.id, diff, label })
                  return (
                    <div className="text-center mb-3 bg-green-500 text-white font-semibold text-xs py-1.5 rounded-lg shadow-sm">
                      ✓ {label}更新
                    </div>
                  )
                })()}

              {/* 卡片內容 */}
              <div className="space-y-3">
                <div className="flex justify-between items-start">
                  <h3 className="font-semibold text-text-primary truncate">
                    {record.customer_name}
                  </h3>
                  <span className="text-xs text-text-secondary bg-bg-tertiary px-2 py-1 rounded">
                    {record.service_date}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center text-sm text-text-secondary">
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    {record.care_staff_name}
                  </div>

                  <div className="flex items-center text-sm text-text-secondary">
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {/* 跨夜更標記 */}
                    {record.start_time && record.end_time && record.start_time > record.end_time && (
                      <span title="跨夜更" className="text-orange-500 mr-1">🌙</span>
                    )}
                    {record.start_time} - {record.end_time}
                  </div>

                  <div className="flex items-center text-sm text-blue-600">
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {record.service_type}
                  </div>
                </div>
              </div>
            </div>
            )
          })}
        </div>
      )}

      {/* 記錄操作模態框 - 使用 Portal 確保穩定渲染 */}
      {showRecordMenu && selectedRecord && (
        <>
          {typeof window !== 'undefined' && createPortal(
            <div 
              className="fixed inset-0 z-[9999] overflow-y-auto"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) {
                  setShowRecordMenu(false)
                  setSelectedRecord(null)
                }
              }}
            >
              {/* 背景遮罩 */}
              <div className="fixed inset-0 bg-black/60 transition-opacity" />
              
              {/* 模態框容器 - 使用 flex 居中 */}
              <div className="fixed inset-0 flex items-center justify-center p-4">
                <div 
                  className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 transform transition-all"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">選擇操作</h3>

                  {/* 記錄詳情 */}
                  <div className="bg-gray-50 rounded-xl p-4 mb-5 border border-gray-200">
                    <div className="text-sm text-gray-500 mb-1.5">
                      {selectedRecord.service_date} {selectedRecord.start_time}-{selectedRecord.end_time}
                    </div>
                    <div className="font-semibold text-gray-900 text-base">
                      {selectedRecord.customer_name}
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      護理員：{selectedRecord.care_staff_name}
                    </div>
                    <div className="text-sm text-primary font-medium mt-1">
                      {selectedRecord.service_type}
                    </div>
                  </div>

                  {/* 操作按鈕 */}
                  <div className="flex space-x-3">
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        console.log('📝 編輯按鈕被點擊:', selectedRecord)
                        onEdit(selectedRecord)
                        setShowRecordMenu(false)
                        setSelectedRecord(null)
                      }}
                      className="btn-apple-primary flex-1"
                    >
                      編輯
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        console.log('🗑️ 刪除按鈕被點擊:', selectedRecord.id)
                        onDelete(selectedRecord.id)
                        setShowRecordMenu(false)
                        setSelectedRecord(null)
                      }}
                      className="flex-1 bg-red-500 text-white py-2.5 px-4 rounded-xl hover:bg-red-600 transition-all duration-300 font-medium"
                    >
                      刪除
                    </button>
                  </div>

                  {/* 取消按鈕 */}
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      setShowRecordMenu(false)
                      setSelectedRecord(null)
                    }}
                    className="btn-apple-secondary w-full mt-4"
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}
        </>
      )}
    </div>
  )
}

function DetailedRecordsList({ filters, onRefresh }: DetailedRecordsListProps) {
  const [records, setRecords] = useState<BillingSalaryRecord[]>([])
  const [originalRecords, setOriginalRecords] = useState<BillingSalaryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'service_date', direction: 'desc' })

  // 分頁狀態
  const [currentPage, setCurrentPage] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)
  const pageSize = 100 // 每頁顯示100筆記錄

  // 編輯狀態
  const [editingRecord, setEditingRecord] = useState<BillingSalaryRecord | null>(null)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)

  // 載入真實數據
  useEffect(() => {
    loadRecords()
  }, [filters]) // 移除 currentPage 依賴，因為不再使用分頁

  const loadRecords = async () => {
    try {
      setLoading(true)
      setError(null)

      // 二月和四月的特別調試
      if (filters.dateRange?.start) {
        const startMonth = new Date(filters.dateRange.start).getMonth() + 1
        if (startMonth === 2 || startMonth === 4) {
          console.log(`🔍 載入${startMonth}月記錄，filters:`, filters)
        }
      }

      // 獲取所有記錄（分批獲取，無上限）
      const response = await fetchAllBillingSalaryRecords(filters)

      // 二月和四月的特別調試
      if (filters.dateRange?.start) {
        const startMonth = new Date(filters.dateRange.start).getMonth() + 1
        if (startMonth === 2 || startMonth === 4) {
          console.log(`🔍 ${startMonth}月 API 響應:`, {
            success: response.success,
            dataExists: !!response.data,
            dataType: typeof response.data,
            dataLength: response.data?.length
          })
        }
      }

      if (response.success && response.data) {
        const fetchedRecords = response.data || []
        setTotalRecords(fetchedRecords.length) // 設置總記錄數
        setOriginalRecords(fetchedRecords)
        // 應用當前排序
        sortRecords(fetchedRecords, sortConfig)
      } else {
        setError(response.error || '載入數據失敗')
      }
    } catch (err) {
      console.error('載入記錄失敗:', err)
      setError('載入數據失敗，請重試')
    } finally {
      setLoading(false)
    }
  }

  // 排序記錄
  const sortRecords = (recordsToSort: BillingSalaryRecord[], config: SortConfig) => {
    const sorted = [...recordsToSort].sort((a, b) => {
      let aValue: string | number
      let bValue: string | number

      switch (config.field) {
        case 'service_date':
          aValue = a.service_date
          bValue = b.service_date
          break
        case 'customer_name':
          aValue = a.customer_name
          bValue = b.customer_name
          break
        case 'customer_id':
          aValue = a.customer_id
          bValue = b.customer_id
          break
        default:
          return 0
      }

      if (aValue < bValue) {
        return config.direction === 'asc' ? -1 : 1
      }
      if (aValue > bValue) {
        return config.direction === 'asc' ? 1 : -1
      }
      return 0
    })

    setRecords(sorted)
  }

  // 處理排序按鈕點擊
  const handleSort = (field: SortField) => {
    const newDirection: SortDirection =
      sortConfig.field === field && sortConfig.direction === 'desc'
        ? 'asc'
        : 'desc'

    const newConfig: SortConfig = { field, direction: newDirection }
    setSortConfig(newConfig)
    sortRecords(originalRecords, newConfig)
  }

  // 編輯功能
  const handleEdit = (record: BillingSalaryRecord) => {
    console.log('🖊️ 第一個 handleEdit - 點擊編輯按鈕，記錄:', record)
    setEditingRecord(record)
    setIsEditModalOpen(true)
    console.log('🖊️ 第一個 handleEdit - 模態框狀態已更新:', {
      isEditModalOpen: true,
      editingRecordId: record.id
    })
  }

  const handleEditSave = async (formData: BillingSalaryFormData) => {
    if (!editingRecord) return

    try {
      setLoading(true)
      console.log('🔄 開始更新記錄:', {
        recordId: editingRecord.id,
        formData
      })

      const response = await updateBillingSalaryRecord(editingRecord.id, formData)

      console.log('📝 更新結果:', response)

      if (response.success) {
        // 🔔 設置更新時間到 localStorage (在任何其他操作之前)
        const updateTime = Date.now()
        const storageKey = `service_update_${editingRecord.id}`
        localStorage.setItem(storageKey, updateTime.toString())
        console.log('💾 設置更新時間到 localStorage:', {
          recordId: editingRecord.id,
          storageKey,
          updateTime
        })
        
        // 🔔 觸發事件通知其他組件
        const event = new CustomEvent('recordUpdated', {
          detail: {
            recordId: editingRecord.id,
            type: 'service',
            updateTime
          }
        })
        window.dispatchEvent(event)
        console.log('📢 觸發更新事件:', event.detail)
        
        // 關閉模態框
        setIsEditModalOpen(false)
        setEditingRecord(null)
        
        // 顯示成功提示 (延遲一點點，確保localStorage已設置)
        setTimeout(() => {
          console.log('✅ 記錄更新成功！')
        }, 100)
        
        // 觸發資料刷新 - 確保狀態更新
        if (onRefresh) {
          console.log('📤 調用 onRefresh 以刷新數據和狀態')
          onRefresh()
        }
        // 重新載入本地記錄列表
        loadRecords()
      } else {
        setError(response.error || '更新記錄失敗')
        console.error('❌ 更新記錄失敗:', response.error || '未知錯誤')
      }
    } catch (err) {
      console.error('更新記錄失敗:', err)
      setError('更新記錄失敗，請重試')
      console.error('❌ 更新記錄失敗:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleEditCancel = () => {
    setIsEditModalOpen(false)
    setEditingRecord(null)
  }

  const handleDelete = async (recordId: string) => {
    if (!confirm('確定要刪除這筆記錄嗎？此操作無法撤銷。')) return

    try {
      setLoading(true)
      console.log('🗑️ 開始刪除記錄:', recordId)

      const response = await deleteBillingSalaryRecord(recordId)

      console.log('🗑️ 刪除結果:', response)

      if (response.success) {
        console.log('✅ 記錄刪除成功！')
        // 觸發資料刷新
        if (onRefresh) {
          onRefresh()
        }
        // 重新載入本地記錄列表
        loadRecords()
      } else {
        setError(response.error || '刪除記錄失敗')
        console.error('❌ 刪除記錄失敗:', response.error || '未知錯誤')
      }
    } catch (err) {
      console.error('刪除記錄失敗:', err)
      setError('刪除記錄失敗，請重試')
      console.error('❌ 刪除記錄失敗:', err)
    } finally {
      setLoading(false)
    }
  }

  // 截斷地址顯示
  const truncateAddress = (address: string, maxLength: number = 30) => {
    if (!address) return ''
    return address.length > maxLength ? address.substring(0, maxLength) + '...' : address
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="border border-border-light rounded-xl p-4 animate-pulse">
            <div className="space-y-3">
              <div className="flex justify-between">
                <div className="h-4 bg-bg-tertiary rounded w-1/4"></div>
                <div className="h-4 bg-bg-tertiary rounded w-1/6"></div>
              </div>
              <div className="h-4 bg-bg-tertiary rounded w-3/4"></div>
              <div className="h-4 bg-bg-tertiary rounded w-2/3"></div>
              <div className="h-4 bg-bg-tertiary rounded w-1/2"></div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-red-600 font-medium mb-2">{error}</p>
        <button
          onClick={loadRecords}
          className="px-4 py-2 bg-primary text-white rounded-xl hover:bg-opacity-90 transition-colors"
        >
          重新載入
        </button>
      </div>
    )
  }

  if (!records || records.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-bg-tertiary rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <p className="text-text-primary font-medium mb-2">沒有找到記錄</p>
        <p className="text-sm text-text-secondary">
          請調整篩選條件或新增服務記錄
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 排序控制按鈕 - 移動端優化 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-border-light pb-4 space-y-3 sm:space-y-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-text-secondary font-medium">排序：</span>

          {/* 按日期排序 */}
          <button
            onClick={() => handleSort('service_date')}
            className={`flex items-center space-x-1 px-2 sm:px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors ${
              sortConfig.field === 'service_date'
                ? 'bg-primary text-white'
                : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary'
            }`}
          >
            <span>日期</span>
            {sortConfig.field === 'service_date' && (
              <svg
                className={`w-3 h-3 sm:w-4 sm:h-4 transition-transform ${
                  sortConfig.direction === 'desc' ? 'rotate-180' : ''
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            )}
          </button>

          {/* 按客戶名稱排序 */}
          <button
            onClick={() => handleSort('customer_name')}
            className={`flex items-center space-x-1 px-2 sm:px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors ${
              sortConfig.field === 'customer_name'
                ? 'bg-primary text-white'
                : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary'
            }`}
          >
            <span className="hidden sm:inline">客戶名稱</span>
            <span className="sm:hidden">客戶</span>
            {sortConfig.field === 'customer_name' && (
              <svg
                className={`w-3 h-3 sm:w-4 sm:h-4 transition-transform ${
                  sortConfig.direction === 'desc' ? 'rotate-180' : ''
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            )}
          </button>

          {/* 按客戶編號排序 */}
          <button
            onClick={() => handleSort('customer_id')}
            className={`flex items-center space-x-1 px-2 sm:px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors ${
              sortConfig.field === 'customer_id'
                ? 'bg-primary text-white'
                : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary'
            }`}
          >
            <span className="hidden sm:inline">客戶編號</span>
            <span className="sm:hidden">編號</span>
            {sortConfig.field === 'customer_id' && (
              <svg
                className={`w-3 h-3 sm:w-4 sm:h-4 transition-transform ${
                  sortConfig.direction === 'desc' ? 'rotate-180' : ''
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            )}
          </button>
        </div>

        {/* 記錄數量顯示 */}
        <div className="text-xs sm:text-sm text-text-secondary text-center sm:text-right">
          共 {records?.length || 0} 筆記錄
        </div>
      </div>

      {/* 記錄列表 - 移動端優化 */}
      <div className="space-y-3">
        {records && records.map((record) => (
          <div
            key={record.id}
            className="border border-border-light rounded-xl p-3 sm:p-4 hover:shadow-md transition-all duration-300 bg-white"
          >
            {/* 第1行：日期、所屬項目、操作按鈕 - 移動端垂直佈局 */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-2 space-y-2 sm:space-y-0">
              <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-4 space-y-1 sm:space-y-0">
                <span className="font-medium text-text-primary text-sm sm:text-base">{record.service_date}</span>
                <span className="text-xs sm:text-sm text-text-secondary">{record.project_category}</span>
              </div>

              {/* 操作按鈕 - 移動端優化 */}
              <div className="flex items-center space-x-2 self-end sm:self-center">
                <button
                  onClick={() => {
                    console.log('🖱️ 編輯按鈕被點擊，記錄ID:', record.id)
                    handleEdit(record)
                  }}
                  className="p-1.5 sm:p-2 text-primary hover:bg-blue-50 rounded-xl transition-colors"
                  title="編輯記錄"
                >
                  <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={() => {
                    console.log('🖱️ 刪除按鈕被點擊，記錄ID:', record.id)
                    handleDelete(record.id)
                  }}
                  className="p-1.5 sm:p-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                  title="刪除記錄"
                >
                  <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>

            {/* 第2行：客戶姓名+編號、服務類型 - 移動端優化 */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-2 space-y-1 sm:space-y-0">
              <div className="flex items-center space-x-2">
                <span className="font-medium text-text-primary text-sm sm:text-base">
                  {record.customer_name} ({record.customer_id})
                </span>
              </div>
              <span className="text-xs sm:text-sm bg-primary text-white px-2 sm:px-3 py-1 rounded-full self-start sm:self-center">
                {record.service_type}
              </span>
            </div>

            {/* 第3行：服務地址 - 移動端優化 */}
            <div className="mb-2">
              <span
                className="text-xs sm:text-sm text-text-secondary cursor-help block break-words overflow-hidden"
                title={record.service_address}
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 1,
                  WebkitBoxOrient: 'vertical'
                }}
              >
                {record.service_address}
              </span>
            </div>

            {/* 第4行：時間、時數、護理人員 - 移動端垂直佈局 */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-xs sm:text-sm space-y-1 sm:space-y-0">
              <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-4 space-y-1 sm:space-y-0">
                <span className="text-text-secondary">
                  {record.start_time}-{record.end_time}
                </span>
                <span className="font-medium text-text-primary">
                  {record.service_hours}小時
                </span>
              </div>
              <span className="font-medium text-text-primary self-start sm:self-center">
                {record.care_staff_name}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* 記錄統計信息 */}
      <div className="text-center text-xs sm:text-sm text-text-secondary mt-6">
        共 {totalRecords} 筆記錄
      </div>

      {/* 編輯模態框 */}
      {isEditModalOpen && editingRecord && (
        <ScheduleFormModal
          isOpen={isEditModalOpen}
          onClose={handleEditCancel}
          onSubmit={handleEditSave}
          isMultiDay={false}
          existingRecord={editingRecord}
        />
      )}
    </div>
  )
}

// Tab 組件定義
interface OverviewTabProps {
  filters: BillingSalaryFilters
  setFilters: (filters: BillingSalaryFilters | ((prev: BillingSalaryFilters) => BillingSalaryFilters)) => void
  updateDateRange: (preset: DateRangePreset) => void
  kpiData: BusinessKPI | null
  kpiLoading: boolean
  categorySummary: ProjectCategorySummary[]
}

interface ReportsTabProps {
  filters: BillingSalaryFilters
  setFilters: (filters: BillingSalaryFilters | ((prev: BillingSalaryFilters) => BillingSalaryFilters)) => void
  updateDateRange: (preset: DateRangePreset) => void
  exportLoading: boolean
  handleExport: () => void
  onCalendarExport: () => void
  calendarExportLoading: boolean
  onEdit: (record: BillingSalaryRecord) => void
  onDelete: (recordId: string) => void
  refreshTrigger: number
  onRefresh?: () => void  // 添加刷新函數
  recordUpdateTimes?: Record<string, Date> // 添加記錄更新時間
}

interface StaffOption {
  name: string
  staffId: string | null
  normalizedName: string
  normalizedId: string | null
}

const normalizeStaffId = (value?: string | null): string | null => {
  if (!value) return null
  return value.trim().toLowerCase()
}

const normalizeStaffName = (value?: string | null): string => {
  if (!value) return ''
  return value
    .trim()
    .replace(/[\s]/g, '')
    .replace(/[()（）]/g, '')
    .toLowerCase()
}

// 概覽頁面組件
function OverviewTab({
  filters,
  setFilters,
  updateDateRange,
  kpiData,
  kpiLoading,
  categorySummary
}: OverviewTabProps) {
  return (
    <div className="space-y-8">
      {/* 搜尋與篩選 - 根據圖片格式 */}
      <div className="card-apple mb-4 sm:mb-6 fade-in-apple">
        <div className="card-apple-header">
          <h3 className="text-lg sm:text-xl font-semibold text-text-primary">搜尋與篩選</h3>
        </div>
        <div className="card-apple-content">
          <h2 className="text-apple-heading text-text-primary mb-4">選擇時段</h2>

          {/* 第一行：快捷選擇按鈕 */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => updateDateRange('thisMonth')}
                className="btn-apple-primary text-sm"
              >
                本月
              </button>
              <button
                onClick={() => updateDateRange('lastMonth')}
                className="btn-apple-secondary text-sm"
              >
                上月
              </button>
              <button
                onClick={() => updateDateRange('last3months')}
                className="btn-apple-secondary text-sm"
              >
                最近3個月
              </button>
              <button
                onClick={() => updateDateRange('last6months')}
                className="btn-apple-secondary text-sm"
              >
                最近6個月
              </button>
              <button
                onClick={() => updateDateRange('thisQuarter')}
                className="btn-apple-secondary text-sm"
              >
                本季度
              </button>
              <button
                onClick={() => updateDateRange('thisYear')}
                className="btn-apple-secondary text-sm"
              >
                本年度
              </button>
            </div>
          </div>

          {/* 第二行：年月選擇器 */}
          <div className="flex items-center gap-4 mb-4">
            {/* 年月選擇器 */}
            <div className="flex items-center gap-3">
              <select
                value={filters.dateRange?.start ? (() => {
                  const [y] = filters.dateRange.start.split('-').map(Number)
                  return y
                })() : new Date().getFullYear()}
                onChange={(e) => {
                  const year = parseInt(e.target.value)
                  const month = filters.dateRange?.start ? (() => {
                    const [, m] = filters.dateRange.start.split('-').map(Number)
                    return m - 1
                  })() : new Date().getMonth()
                  const startDate = new Date(year, month, 1)
                  const endDate = new Date(year, month + 1, 0)

                  // 使用本地日期格式避免時區問題
                  const start = year + '-' +
                               String(month + 1).padStart(2, '0') + '-01'
                  const end = endDate.getFullYear() + '-' +
                             String(endDate.getMonth() + 1).padStart(2, '0') + '-' +
                             String(endDate.getDate()).padStart(2, '0')

                  setFilters(prev => ({
                    ...prev,
                    dateRange: { start, end }
                  }))
                }}
                className="form-input-apple pr-10 appearance-none cursor-pointer"
              >
                {Array.from({ length: 5 }, (_, i) => {
                  const year = new Date().getFullYear() - 2 + i
                  return (
                    <option key={year} value={year}>
                      {year}年
                    </option>
                  )
                })}
              </select>

              <select
                value={filters.dateRange?.start ? (() => {
                  const [, m] = filters.dateRange.start.split('-').map(Number)
                  return m - 1
                })() : new Date().getMonth()}
                onChange={(e) => {
                  const year = filters.dateRange?.start ? (() => {
                    const [y] = filters.dateRange.start.split('-').map(Number)
                    return y
                  })() : new Date().getFullYear()
                  const month = parseInt(e.target.value)
                  const startDate = new Date(year, month, 1)
                  const endDate = new Date(year, month + 1, 0)

                  // 使用本地日期格式避免時區問題
                  const start = year + '-' +
                               String(month + 1).padStart(2, '0') + '-01'
                  const end = endDate.getFullYear() + '-' +
                             String(endDate.getMonth() + 1).padStart(2, '0') + '-' +
                             String(endDate.getDate()).padStart(2, '0')

                  setFilters(prev => ({
                    ...prev,
                    dateRange: { start, end }
                  }))
                }}
                className="px-3 py-2 text-sm border border-border-light rounded-xl bg-bg-primary text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={i}>
                    {i + 1}月
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 第二行：月曆時間段選擇 */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-text-secondary">時間段：</label>
            <input
              type="date"
              value={filters.dateRange?.start || ''}
              onChange={(e) => setFilters(prev => ({
                ...prev,
                dateRange: { ...prev.dateRange, start: e.target.value }
              }))}
              className="px-3 py-2 text-sm border border-border-light rounded-xl bg-bg-primary text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
            <span className="text-text-secondary">至</span>
            <input
              type="date"
              value={filters.dateRange?.end || ''}
              onChange={(e) => setFilters(prev => ({
                ...prev,
                dateRange: { ...prev.dateRange, end: e.target.value }
              }))}
              className="px-3 py-2 text-sm border border-border-light rounded-xl bg-bg-primary text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          <div className="mt-4 text-sm text-text-secondary">
            當前範圍：{filters.dateRange?.start || '未設定'} ~ {filters.dateRange?.end || '未設定'}
          </div>
        </div>
      </div>

      {/* KPI 卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
        {kpiLoading ? (
          <div className="col-span-full text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
            <p className="text-sm text-text-secondary mt-3">計算中...</p>
          </div>
        ) : kpiData ? (
          <>
            <div className="card-apple border border-border-light p-4 md:p-6 text-center">
              <div className="text-2xl md:text-3xl font-bold text-text-primary mb-2">
                ${kpiData.totalRevenue.toLocaleString()}
              </div>
              <div className="text-xs md:text-sm text-text-secondary">總收入</div>
              {kpiData.revenueGrowthRate !== 0 && (
                <div className={`text-xs mt-2 ${
                  kpiData.revenueGrowthRate >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {kpiData.revenueGrowthRate >= 0 ? '↗' : '↘'} {Math.abs(kpiData.revenueGrowthRate).toFixed(1)}%
                </div>
              )}
            </div>

            <div className="card-apple border border-border-light p-4 md:p-6 text-center">
              <div className="text-2xl md:text-3xl font-bold text-text-primary mb-2">
                ${kpiData.totalProfit.toLocaleString()}
              </div>
              <div className="text-xs md:text-sm text-text-secondary">總利潤</div>
              <div className="text-xs text-text-secondary mt-2">
                利潤率: {kpiData.totalRevenue > 0 ? ((kpiData.totalProfit / kpiData.totalRevenue) * 100).toFixed(1) : 0}%
              </div>
            </div>

            <div className="card-apple border border-border-light p-4 md:p-6 text-center">
              <div className="text-2xl md:text-3xl font-bold text-text-primary mb-2">
                {kpiData.totalServiceHours.toFixed(1)}
              </div>
              <div className="text-xs md:text-sm text-text-secondary">總服務時數</div>
            </div>

            <div className="card-apple border border-border-light p-4 md:p-6 text-center">
              <div className="text-2xl md:text-3xl font-bold text-text-primary mb-2">
                ${kpiData.avgProfitPerHour.toFixed(2)}
              </div>
              <div className="text-xs md:text-sm text-text-secondary">每小時利潤</div>
            </div>
          </>
        ) : (
          <div className="col-span-full text-center py-12">
            <p className="text-text-secondary">選取的日期範圍內暫無數據</p>
          </div>
        )}
      </div>

      {/* 項目分類統計 - 簡化版 */}
      <div className="card-apple border border-border-light fade-in-apple">
        <div className="p-6">
          <h3 className="text-apple-heading text-text-primary mb-6">項目分類統計</h3>

          {categorySummary && categorySummary.length > 0 ? (
            <div className="space-y-4">
              {categorySummary.map((summary, index) => (
                <div key={summary.category} className="flex items-center justify-between p-4 bg-bg-secondary rounded-xl border border-border-light">
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-primary rounded-full mr-3"></div>
                    <div>
                      <h4 className="font-medium text-text-primary">{summary.category}</h4>
                      <p className="text-sm text-text-secondary">
                        {summary.recordCount} 筆記錄 • {summary.uniqueCustomers} 位客戶
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-text-primary">
                      ${summary.totalFee.toLocaleString()}
                    </div>
                    <div className="text-sm text-text-secondary">
                      {summary.totalHours.toFixed(1)}h • 利潤 ${summary.totalProfit.toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}

              {/* 顯示總計 */}
              <div className="flex items-center justify-between p-4 bg-primary/10 rounded-xl border-2 border-primary mt-6">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-primary rounded-full mr-3"></div>
                  <div>
                    <h4 className="font-bold text-text-primary">所有項目總計</h4>
                    <p className="text-sm text-text-secondary">
                      {categorySummary.reduce((sum, s) => sum + s.recordCount, 0)} 筆記錄 • {categorySummary.length} 個項目
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-primary">
                    ${categorySummary.reduce((sum, s) => sum + s.totalFee, 0).toLocaleString()}
                  </div>
                  <div className="text-sm text-text-secondary">
                    {categorySummary.reduce((sum, s) => sum + s.totalHours, 0).toFixed(1)}h • 利潤 ${categorySummary.reduce((sum, s) => sum + s.totalProfit, 0).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-text-secondary">選取的日期範圍內暫無項目數據</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// 排班小結組件
function ScheduleSummaryView({ 
  localSchedules, 
  updateTrigger 
}: { 
  localSchedules: Record<string, BillingSalaryFormData[]>
  updateTrigger?: number
}) {
  const calculateSummary = () => {
    const allSchedules = Object.values(localSchedules || {}).flat()
    const totalHours = Math.round((allSchedules || []).reduce((sum, schedule) => sum + (schedule.service_hours || 0), 0) * 100) / 100
    const totalFee = Math.round((allSchedules || []).reduce((sum, schedule) => sum + (schedule.service_fee || 0), 0) * 100) / 100
    const totalCount = allSchedules?.length || 0

    return {
      totalCount,
      totalHours,
      totalFee
    }
  }

  // 社區券統計 state
  const [voucherSummary, setVoucherSummary] = useState<{
    service_type: string
    count: number
    total_hours: number
    total_rate: number
    total_amount: number
  }[]>([])

  const calculateVoucherSummary = async () => {
    const allSchedules = Object.values(localSchedules || {}).flat()
    console.log('計算社區券統計 - 本地排程:', localSchedules) // 調試日誌
    console.log('所有排程:', allSchedules) // 調試日誌

    try {
      // 獲取 voucher_rate 費率表
      const voucherRatesResponse = await fetchVoucherRates()
      if (!voucherRatesResponse.success || !voucherRatesResponse.data) {
        console.error('無法獲取社區券費率')
        return []
      }

      const voucherRates = voucherRatesResponse.data
      console.log('社區券費率表:', voucherRates) // 調試日誌

      // 按服務類型分組統計
      const serviceTypeStats: Record<string, {
        count: number
        total_hours: number
        rate: number
        total_amount: number
      }> = {}

      allSchedules.forEach(schedule => {
        const serviceType = schedule.service_type || '未分類'
        const rate = getApplicableRate(voucherRates, serviceType, schedule.service_date)
        const hours = schedule.service_hours || 0

        if (!serviceTypeStats[serviceType]) {
          serviceTypeStats[serviceType] = {
            count: 0,
            total_hours: 0,
            rate: rate,
            total_amount: 0
          }
        }

        serviceTypeStats[serviceType].count += 1
        serviceTypeStats[serviceType].total_hours = Math.round((serviceTypeStats[serviceType].total_hours + hours) * 100) / 100
        // 使用 Math.round 修復浮點數精度問題
        serviceTypeStats[serviceType].total_amount = Math.round((serviceTypeStats[serviceType].total_amount + Math.round(hours * rate * 100) / 100) * 100) / 100
      })

      const result = Object.entries(serviceTypeStats).map(([serviceType, stats]) => ({
        service_type: serviceType,
        count: stats.count,
        total_hours: stats.total_hours,
        total_rate: stats.rate,
        total_amount: stats.total_amount
      }))

      console.log('社區券統計結果:', result) // 調試日誌
      setVoucherSummary(result)
      return result
    } catch (error) {
      console.error('計算社區券統計失敗:', error)
      setVoucherSummary([])
      return []
    }
  }

  // 當本地排程改變時重新計算社區券統計
  useEffect(() => {
    calculateVoucherSummary()
  }, [localSchedules, updateTrigger])

  const summary = calculateSummary()
  const totalVoucherAmount = voucherSummary.reduce((sum: number, item) => sum + item.total_amount, 0)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-apple-heading text-text-primary mb-4">排班小結</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-blue-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-primary">{summary.totalCount}</div>
            <div className="text-sm text-text-secondary">總排班數</div>
          </div>
          <div className="bg-green-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-green-600">{summary.totalHours.toFixed(1)}</div>
            <div className="text-sm text-text-secondary">總時數</div>
          </div>
          <div className="bg-orange-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-orange-600">${summary.totalFee.toFixed(2)}</div>
            <div className="text-sm text-text-secondary">總服務費用</div>
          </div>
        </div>
      </div>

      {/* 社區券機數統計 */}
      {voucherSummary.length > 0 ? (
        <div>
          <h3 className="text-apple-heading text-text-primary mb-4">社區券機數統計（當前排班）</h3>

          {/* 總計卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-purple-50 rounded-xl p-4">
              <div className="text-2xl font-bold text-purple-600">{summary.totalCount}</div>
              <div className="text-sm text-text-secondary">總服務次數</div>
            </div>
            <div className="bg-indigo-50 rounded-xl p-4">
              <div className="text-2xl font-bold text-indigo-600">{summary.totalHours.toFixed(1)}</div>
              <div className="text-sm text-text-secondary">總服務時數</div>
            </div>
            <div className="bg-pink-50 rounded-xl p-4">
              <div className="text-2xl font-bold text-pink-600">${totalVoucherAmount.toFixed(2)}</div>
              <div className="text-sm text-text-secondary">總社區券金額</div>
            </div>
          </div>

          {/* 服務類型明細表格 */}
          <div className="bg-white border border-border-light rounded-xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-bg-secondary">
                <tr>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-primary">服務類型</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-primary">次數</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-primary">時數</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-primary">費率/小時</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-primary">金額</th>
                </tr>
              </thead>
              <tbody>
                {voucherSummary && voucherSummary.map((item, index) => (
                  <tr key={item.service_type} className={index % 2 === 0 ? 'bg-white' : 'bg-bg-secondary'}>
                    <td className="py-3 px-4 text-sm text-text-primary">{item.service_type}</td>
                    <td className="py-3 px-4 text-sm text-text-primary">{item.count}</td>
                    <td className="py-3 px-4 text-sm text-text-primary">{item.total_hours.toFixed(1)}</td>
                    <td className="py-3 px-4 text-sm text-text-secondary">${item.total_rate.toFixed(2)}</td>
                    <td className="py-3 px-4 text-sm text-text-primary font-medium">${item.total_amount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div>
          <h3 className="text-apple-heading text-text-primary mb-4">社區券機數統計（當前排班）</h3>
          <div className="bg-bg-secondary rounded-xl p-6 text-center">
            <div className="text-text-secondary">
              <svg className="w-12 h-12 mx-auto mb-3 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-lg font-medium text-text-primary mb-2">尚無排班資料</p>
              <p className="text-sm text-text-secondary">請先添加排班記錄以查看社區券統計</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// 社區券統計組件
function VoucherSummaryView({ filters, refreshTrigger }: { filters: BillingSalaryFilters; refreshTrigger?: number }) {
  const [voucherData, setVoucherData] = useState<{
    serviceTypeSummary: {
      service_type: string
      count: number
      total_hours: number
      total_rate: number
      total_amount: number
    }[]
    grandTotal: {
      total_count: number
      total_hours: number
      total_amount: number
    }
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadVoucherSummary = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await calculateVoucherSummary(filters)
        if (response.success && response.data) {
          setVoucherData(response.data)
        } else {
          setError(response.error || '載入社區券統計失敗')
        }
      } catch (err) {
        console.error('載入社區券統計失敗:', err)
        setError('載入社區券統計失敗')
      } finally {
        setLoading(false)
      }
    }

    loadVoucherSummary()
  }, [filters, refreshTrigger])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
        <span className="ml-3 text-text-secondary">載入統計數據中...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600">{error}</p>
      </div>
    )
  }

  if (!voucherData) {
    return (
      <div className="text-center py-8">
        <p className="text-text-secondary">暫無數據</p>
      </div>
    )
  }

  return (
    <div>
      <h3 className="text-apple-heading text-text-primary mb-4">社區券機數統計</h3>

      {/* 總計卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-blue-50 rounded-xl p-4">
          <div className="text-2xl font-bold text-primary">{voucherData.grandTotal.total_count}</div>
          <div className="text-sm text-text-secondary">總服務次數</div>
        </div>
        <div className="bg-green-50 rounded-xl p-4">
          <div className="text-2xl font-bold text-green-600">{voucherData.grandTotal.total_hours.toFixed(1)}</div>
          <div className="text-sm text-text-secondary">總服務時數</div>
        </div>
        <div className="bg-orange-50 rounded-xl p-4">
          <div className="text-2xl font-bold text-orange-600">${voucherData.grandTotal.total_amount.toFixed(2)}</div>
          <div className="text-sm text-text-secondary">總社區券金額</div>
        </div>
      </div>

      {/* 服務類型明細表格 */}
      <div className="bg-white border border-border-light rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-bg-secondary">
            <tr>
              <th className="text-left py-3 px-4 text-sm font-medium text-text-primary">服務類型</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-text-primary">次數</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-text-primary">時數</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-text-primary">單價</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-text-primary">金額</th>
            </tr>
          </thead>
          <tbody>
            {voucherData.serviceTypeSummary && voucherData.serviceTypeSummary.map((item, index) => (
              <tr key={item.service_type} className={index % 2 === 0 ? 'bg-white' : 'bg-bg-secondary'}>
                <td className="py-3 px-4 text-sm text-text-primary">{item.service_type}</td>
                <td className="py-3 px-4 text-sm text-text-primary">{item.count}</td>
                <td className="py-3 px-4 text-sm text-text-primary">{item.total_hours.toFixed(1)}</td>
                <td className="py-3 px-4 text-sm text-text-primary">${item.total_rate.toFixed(2)}</td>
                <td className="py-3 px-4 text-sm text-text-primary font-medium">${item.total_amount.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// 排程頁面組件
function ScheduleTab({ 
  filters, 
  onCalendarExport, 
  calendarExportLoading 
}: { 
  filters: BillingSalaryFilters;
  onCalendarExport: () => void;
  calendarExportLoading: boolean;
}) {
  // 從 filters 初始化 currentDate
  const [currentDate, setCurrentDate] = useState(() => {
    if (filters.dateRange?.start) {
      const [year, month] = filters.dateRange.start.split('-').map(Number)
      return new Date(year, month - 1, 1)
    }
    return new Date()
  })
  const [scheduleData, setScheduleData] = useState<Record<string, any[]>>({})
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedDates, setSelectedDates] = useState<string[]>([]) // 多日期選擇
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false) // 多選模式
  const [formSubmitting, setFormSubmitting] = useState(false)

  // 本地排程狀態 - 新增的排程先存在這裡，不立即保存到 Supabase
  const [localSchedules, setLocalSchedules] = useState<Record<string, BillingSalaryFormData[]>>({})

  // 月曆客戶篩選狀態
  const [selectedCustomerFilter, setSelectedCustomerFilter] = useState<string>('all') // 'all' 或客戶名稱

  // 全域已選客戶狀態 - 在外面選擇後，新增排班時自動填入
  const [globalSelectedCustomer, setGlobalSelectedCustomer] = useState<{
    customer_id: string
    customer_name: string
    phone: string
    service_address: string
    project_category?: string
  } | null>(null)

  // 頂部選擇客戶彈窗狀態
  const [showGlobalCustomerPicker, setShowGlobalCustomerPicker] = useState(false)
  const [globalPickerMonth, setGlobalPickerMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [globalPickerCategory, setGlobalPickerCategory] = useState<string>('')
  const [globalPickerProjectCategory, setGlobalPickerProjectCategory] = useState<string>('')
  const [globalPickerShowAll, setGlobalPickerShowAll] = useState(false)
  const [globalPickerCustomerList, setGlobalPickerCustomerList] = useState<{
    customer_id: string
    customer_name: string
    phone: string
    service_address: string
    customer_type: string
    project_category: string
    hasLastMonthService: boolean
    hasCurrentMonthSchedule: boolean
    currentMonthScheduleCount: number
  }[]>([])
  const [globalPickerLoading, setGlobalPickerLoading] = useState(false)

  // 社區券統計更新觸發器
  const [voucherUpdateTrigger, setVoucherUpdateTrigger] = useState(0)

  // 儲存後導出日曆提示狀態
  const [showExportPrompt, setShowExportPrompt] = useState(false)
  const [exportPromptStep, setExportPromptStep] = useState<'ask' | 'nameMode' | 'staffPicker'>('ask')
  const [exportNameMode, setExportNameMode] = useState<'customer' | 'staff'>('customer')
  const [savedScheduleFilters, setSavedScheduleFilters] = useState<BillingSalaryFilters | null>(null)
  const [savedStaffNames, setSavedStaffNames] = useState<string[]>([])
  const [savedCustomerNames, setSavedCustomerNames] = useState<string[]>([])
  const [selectedExportStaff, setSelectedExportStaff] = useState<string>('')
  const [exportingCalendar, setExportingCalendar] = useState(false)

  // 當 filters 的日期範圍變化時，自動跳轉月曆到對應月份
  useEffect(() => {
    if (filters.dateRange?.start) {
      // 解析日期字串 (格式: YYYY-MM-DD)，避免時區問題
      const [year, month] = filters.dateRange.start.split('-').map(Number)
      console.log('📅 ScheduleTab 同步月曆到:', year, month)
      setCurrentDate(new Date(year, month - 1, 1))
    }
  }, [filters.dateRange.start])

  // 載入月曆數據
  useEffect(() => {
    const loadCalendarData = async () => {
      // 載入現有的排程數據
      try {
        // 這裡可以載入現有的排程數據
        console.log('載入月曆數據')
      } catch (error) {
        console.error('載入月曆數據失敗:', error)
      }
    }
    loadCalendarData()
  }, [currentDate])

  // 本地排程編輯模態框狀態
  const [localScheduleEditModal, setLocalScheduleEditModal] = useState<{
    isOpen: boolean
    schedule: BillingSalaryFormData | null
    dateStr: string
    scheduleIndex: number
  }>({
    isOpen: false,
    schedule: null,
    dateStr: '',
    scheduleIndex: -1
  })

  // 正在編輯的本地排程狀態
  const [editingLocalSchedule, setEditingLocalSchedule] = useState<{
    originalDateStr: string
    originalIndex: number
    schedule: BillingSalaryFormData | null
  } | null>(null)

  // 添加新的狀態：統計視圖（移除，不再需要）

  // 計算本地排程總數
  const getTotalLocalSchedules = () => {
    return Object.values(localSchedules || {}).reduce((total, daySchedules) => total + (daySchedules?.length || 0), 0)
  }

  // 獲取本地排程中的所有客戶名稱
  const getLocalCustomerNames = () => {
    const customerNames = new Set<string>()
    Object.values(localSchedules || {}).forEach(daySchedules => {
      ;(daySchedules || []).forEach(schedule => {
        if (schedule.customer_name) {
          customerNames.add(schedule.customer_name)
        }
      })
    })
    return Array.from(customerNames).sort()
  }

  // 根據篩選條件獲取要顯示的本地排程
  const getFilteredLocalSchedules = () => {
    if (selectedCustomerFilter === 'all') {
      return localSchedules
    }

    const filtered: Record<string, BillingSalaryFormData[]> = {}
    Object.entries(localSchedules).forEach(([dateStr, daySchedules]) => {
      const filteredSchedules = daySchedules.filter(schedule =>
        schedule.customer_name === selectedCustomerFilter
      )
      if (filteredSchedules.length > 0) {
        filtered[dateStr] = filteredSchedules
      }
    })
    return filtered
  }

  // 計算本地排程小結
  const calculateLocalScheduleSummary = () => {
    const allSchedules = Object.values(localSchedules || {}).flat()
    const totalHours = (allSchedules || []).reduce((sum, schedule) => sum + (schedule.service_hours || 0), 0)
    const totalFee = (allSchedules || []).reduce((sum, schedule) => sum + (schedule.service_fee || 0), 0)
    const totalCount = allSchedules?.length || 0

    return {
      totalCount,
      totalHours,
      totalFee
    }
  }

  // 載入全域客戶選擇器的客戶列表
  const loadGlobalPickerCustomers = async () => {
    setGlobalPickerLoading(true)
    try {
      // 解析月份
      const [year, month] = globalPickerMonth.split('-').map(Number)
      const currentMonthStart = `${year}-${String(month).padStart(2, '0')}-01`
      const currentMonthEnd = `${year}-${String(month).padStart(2, '0')}-31`
      
      // 上月
      const lastMonth = month === 1 ? 12 : month - 1
      const lastMonthYear = month === 1 ? year - 1 : year
      const lastMonthStart = `${lastMonthYear}-${String(lastMonth).padStart(2, '0')}-01`
      const lastMonthEnd = `${lastMonthYear}-${String(lastMonth).padStart(2, '0')}-31`

      // 查詢客戶資料
      const { data: customers, error: customerError } = await supabase
        .from('customer_personal_data')
        .select('customer_id, customer_name, phone, service_address, customer_type')

      if (customerError) {
        console.error('查詢客戶失敗:', customerError)
        setGlobalPickerCustomerList([])
        return
      }

      // 查詢上月有服務的客戶
      const { data: lastMonthRecords } = await supabase
        .from('billing_salary_data')
        .select('customer_id, customer_name, project_category')
        .gte('service_date', lastMonthStart)
        .lte('service_date', lastMonthEnd)

      // 建立上月服務客戶集合及其 project_category
      const lastMonthCustomers = new Map<string, string>()
      ;(lastMonthRecords || []).forEach((record: { customer_id: string | null; customer_name: string | null; project_category: string | null }) => {
        const key = record.customer_id || record.customer_name
        if (key && !lastMonthCustomers.has(key)) {
          lastMonthCustomers.set(key, record.project_category || '')
        }
      })

      // 查詢本月已安排的排程
      const { data: currentMonthRecords } = await supabase
        .from('billing_salary_data')
        .select('customer_id, customer_name')
        .gte('service_date', currentMonthStart)
        .lte('service_date', currentMonthEnd)

      // 計算每個客戶本月的排程數量（同時用 customer_id 和 customer_name 匹配）
      const currentMonthScheduleCountById = new Map<string, number>()
      const currentMonthScheduleCountByName = new Map<string, number>()
      ;(currentMonthRecords || []).forEach((record: { customer_id: string | null; customer_name: string | null }) => {
        // 用 customer_id 計數
        if (record.customer_id) {
          currentMonthScheduleCountById.set(record.customer_id, (currentMonthScheduleCountById.get(record.customer_id) || 0) + 1)
        }
        // 用 customer_name 計數
        if (record.customer_name) {
          currentMonthScheduleCountByName.set(record.customer_name, (currentMonthScheduleCountByName.get(record.customer_name) || 0) + 1)
        }
      })

      // 定義客戶列表項目類型
      type GlobalPickerCustomerItem = {
        customer_id: string
        customer_name: string
        phone: string
        service_address: string
        customer_type: string
        project_category: string
        hasLastMonthService: boolean
        hasCurrentMonthSchedule: boolean
        currentMonthScheduleCount: number
      }

      // 組合客戶列表
      let customerList: GlobalPickerCustomerItem[] = (customers || []).map((customer: { customer_id: string | null; customer_name: string | null; phone: string | null; service_address: string | null; customer_type: string | null }) => {
        const key = customer.customer_id || customer.customer_name || ''
        const hasLastMonthService = lastMonthCustomers.has(key)
        const projectCategory = lastMonthCustomers.get(key) || ''
        
        // 同時用 customer_id 和 customer_name 查找本月排程數量，取較大值
        const countById = customer.customer_id ? (currentMonthScheduleCountById.get(customer.customer_id) || 0) : 0
        const countByName = customer.customer_name ? (currentMonthScheduleCountByName.get(customer.customer_name) || 0) : 0
        const scheduleCount = Math.max(countById, countByName)
        
        return {
          customer_id: customer.customer_id || '',
          customer_name: customer.customer_name || '',
          phone: customer.phone || '',
          service_address: customer.service_address || '',
          customer_type: customer.customer_type || '',
          project_category: projectCategory,
          hasLastMonthService,
          hasCurrentMonthSchedule: scheduleCount > 0,
          currentMonthScheduleCount: scheduleCount
        }
      })

      // 篩選條件
      if (globalPickerCategory) {
        customerList = customerList.filter(c => c.customer_type === globalPickerCategory)
      }
      if (globalPickerProjectCategory) {
        customerList = customerList.filter(c => c.project_category === globalPickerProjectCategory)
      }
      if (!globalPickerShowAll) {
        customerList = customerList.filter(c => c.hasLastMonthService)
      }

      // 排序：上月有服務的排前面
      customerList.sort((a, b) => {
        if (a.hasLastMonthService !== b.hasLastMonthService) {
          return a.hasLastMonthService ? -1 : 1
        }
        return a.customer_name.localeCompare(b.customer_name, 'zh-Hant')
      })

      setGlobalPickerCustomerList(customerList)
    } catch (error) {
      console.error('載入客戶列表失敗:', error)
      setGlobalPickerCustomerList([])
    } finally {
      setGlobalPickerLoading(false)
    }
  }

  // 當全域客戶選擇器打開或篩選條件改變時載入客戶列表
  useEffect(() => {
    if (showGlobalCustomerPicker) {
      loadGlobalPickerCustomers()
    }
  }, [showGlobalCustomerPicker, globalPickerMonth, globalPickerCategory, globalPickerProjectCategory, globalPickerShowAll])

  // 確認儲存本地排程到Supabase（只儲存篩選後的）
  const handleSaveLocalSchedules = async () => {
    const filteredSchedules = getFilteredLocalSchedules()
    const filteredTotal = Object.values(filteredSchedules || {}).reduce((total, daySchedules) => total + (daySchedules?.length || 0), 0)

    if (filteredTotal === 0) {
      if (selectedCustomerFilter === 'all') {
        alert('沒有待儲存的排程')
      } else {
        alert(`沒有 ${selectedCustomerFilter} 的待儲存排程`)
      }
      return
    }

    const customerInfo = selectedCustomerFilter === 'all' ? '全部' : selectedCustomerFilter
    const confirmSave = confirm(`確定要儲存 ${customerInfo} 的 ${filteredTotal} 個排程到資料庫嗎？`)
    if (!confirmSave) return

    try {
      setFormSubmitting(true)

      // 將篩選後的本地排程直接儲存到 Supabase
      for (const [dateStr, daySchedules] of Object.entries(filteredSchedules)) {
        for (const schedule of daySchedules) {
          // 使用 Math.round 修復浮點數精度問題
          const calcHourlyRate = schedule.hourly_rate || (schedule.service_hours > 0 ? Math.round(((schedule.service_fee || 0) / schedule.service_hours) * 100) / 100 : 0)
          const calcHourlySalary = schedule.hourly_salary || (schedule.service_hours > 0 ? Math.round(((schedule.staff_salary || 0) / schedule.service_hours) * 100) / 100 : 0)
          
          const supabaseData = {
            customer_id: schedule.customer_id,
            staff_id: schedule.staff_id,
            care_staff_name: schedule.care_staff_name,
            service_date: schedule.service_date,
            start_time: schedule.start_time,
            end_time: schedule.end_time,
            service_type: schedule.service_type,
            service_address: schedule.service_address,
            hourly_rate: calcHourlyRate,
            service_fee: Math.round((schedule.service_fee || 0) * 100) / 100,
            staff_salary: Math.round((schedule.staff_salary || 0) * 100) / 100,
            phone: schedule.phone,
            customer_name: schedule.customer_name,
            service_hours: schedule.service_hours,
            hourly_salary: calcHourlySalary,
            project_category: schedule.project_category,
            project_manager: schedule.project_manager
          }

          // 直接使用 Supabase 客戶端儲存資料（正確的表名）
          const { data, error } = await supabase
            .from('billing_salary_data')
            .insert([supabaseData])

          if (error) {
            console.error('Supabase 儲存錯誤:', error)
            throw new Error(`儲存排程失敗: ${error.message}`)
          }

          console.log('成功儲存排程到 Supabase:', data)
        }
      }

      // 從本地排程中移除已儲存的排程
      if (selectedCustomerFilter === 'all') {
        // 如果是全部儲存，清空所有本地排程
        setLocalSchedules({})
      } else {
        // 如果是特定客戶，只移除該客戶的排程
        setLocalSchedules(prev => {
          const newSchedules = { ...prev }
          Object.keys(filteredSchedules).forEach(dateStr => {
            if (newSchedules[dateStr]) {
              newSchedules[dateStr] = newSchedules[dateStr].filter(schedule =>
                schedule.customer_name !== selectedCustomerFilter
              )
              // 如果該日期沒有排程了，刪除整個日期鍵
              if (newSchedules[dateStr].length === 0) {
                delete newSchedules[dateStr]
              }
            }
          })
          return newSchedules
        })
      }

      // 收集已儲存排程的客戶和護理員資訊
      const allSavedSchedules = Object.values(filteredSchedules).flat()
      const staffNames = Array.from(new Set(
        allSavedSchedules
          .map(s => s.care_staff_name)
          .filter((name): name is string => Boolean(name && name.trim()))
      ))
      const customerNames = Array.from(new Set(
        allSavedSchedules
          .map(s => s.customer_name)
          .filter((name): name is string => Boolean(name && name.trim()))
      ))
      const customerIds = Array.from(new Set(
        allSavedSchedules
          .map(s => s.customer_id)
          .filter((id): id is string => Boolean(id && id.trim()))
      ))

      // 計算日期範圍
      const allDates = Object.keys(filteredSchedules).sort()
      const dateRangeStart = allDates[0] || ''
      const dateRangeEnd = allDates[allDates.length - 1] || ''

      // 儲存資訊以供導出使用 - 只導出剛才儲存的客戶
      setSavedStaffNames(staffNames)
      setSavedCustomerNames(customerNames)

      // 構建導出篩選條件 - 確保只包含剛才儲存的客戶
      const exportFilterForSaved: BillingSalaryFilters = {
        dateRange: { start: dateRangeStart, end: dateRangeEnd },
      }
      // 優先用 customer_id 篩選，其次用客戶名稱
      if (customerIds.length > 0) {
        exportFilterForSaved.selectedCustomerIds = customerIds
      } else if (customerNames.length === 1) {
        // 只有一位客戶，用名稱搜尋
        exportFilterForSaved.searchTerm = customerNames[0]
      } else if (selectedCustomerFilter !== 'all') {
        // 特定客戶篩選
        exportFilterForSaved.searchTerm = selectedCustomerFilter
      } else if (customerNames.length > 0) {
        // 多位客戶但無 ID，用第一位名稱（至少限縮結果）
        exportFilterForSaved.searchTerm = customerNames[0]
      }
      setSavedScheduleFilters(exportFilterForSaved)

      alert(`成功儲存 ${customerInfo} 的 ${filteredTotal} 個排程到資料庫！`)

      // 儲存成功後彈出導出日曆提示
      setExportPromptStep('ask')
      setExportNameMode('customer')
      setSelectedExportStaff('')
      setShowExportPrompt(true)

    } catch (error) {
      console.error('儲存本地排程失敗:', error)
      const errorMessage = error instanceof Error ? error.message : '未知錯誤'
      alert(`儲存排程時發生錯誤: ${errorMessage}`)
    } finally {
      setFormSubmitting(false)
    }
  }

  // 處理導出名稱模式選擇
  const handleNameModeSelect = (mode: 'customer' | 'staff') => {
    setExportNameMode(mode)
    if (mode === 'staff' && savedStaffNames.length > 1) {
      // 多位護理員，彈出選擇
      setExportPromptStep('staffPicker')
    } else if (mode === 'staff' && savedStaffNames.length === 1) {
      // 只有一位護理員，直接用
      setSelectedExportStaff(savedStaffNames[0])
      handleExportAfterSaveWithParams(savedScheduleFilters!, 'staff', savedStaffNames[0])
    } else {
      // 客戶名稱模式，直接導出
      handleExportAfterSaveWithParams(savedScheduleFilters!, 'customer', '')
    }
  }

  // 帶參數的導出（避免狀態延遲問題）
  const handleExportAfterSaveWithParams = async (
    exportFilters: BillingSalaryFilters,
    nameMode: 'customer' | 'staff',
    staffName: string
  ) => {
    setExportingCalendar(true)
    try {
      // 如果選擇護理人員模式，加上護理人員篩選
      const filtersToUse: BillingSalaryFilters = nameMode === 'staff' && staffName
        ? { ...exportFilters, careStaffName: staffName }
        : exportFilters

      console.log('📅 導出日曆 - 篩選條件:', JSON.stringify(filtersToUse, null, 2))

      const exportOptions: CalendarExportOptions = {
        format: 'pdf',
        filters: filtersToUse,
        includeStaffDetails: true,
        includeCustomerDetails: false,
        timezone: 'Asia/Hong_Kong',
        nameMode: nameMode,
        selectedStaffName: nameMode === 'staff' ? staffName : undefined
      }

      const result = await exportCalendar(exportOptions)

      if (result.success && result.data) {
        const htmlContent = result.data as string
        const viewer = window.open('', '_blank')
        if (viewer && viewer.document) {
          viewer.opener = null
          viewer.document.open()
          viewer.document.write(htmlContent)
          viewer.document.close()
        } else {
          const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          window.location.href = url
          setTimeout(() => URL.revokeObjectURL(url), 60_000)
        }
        setShowExportPrompt(false)
      } else {
        alert(`日曆導出失敗: ${result.error}`)
      }
    } catch (error) {
      console.error('日曆導出錯誤:', error)
      alert('日曆導出失敗，請稍後再試')
    } finally {
      setExportingCalendar(false)
    }
  }

  // 清除特定本地排程
  const handleDeleteLocalSchedule = (dateStr: string, scheduleIndex: number) => {
    setLocalSchedules(prev => {
      const newSchedules = { ...prev }
      if (newSchedules[dateStr]) {
        newSchedules[dateStr] = newSchedules[dateStr].filter((_, index) => index !== scheduleIndex)
        // 如果該日期沒有排程了，刪除整個日期鍵
        if (newSchedules[dateStr].length === 0) {
          delete newSchedules[dateStr]
        }
      }
      return newSchedules
    })
    // 觸發社區券統計更新
    setVoucherUpdateTrigger(prev => prev + 1)
  }

  // 處理本地排程點擊 - 打開編輯/刪除選項
  const handleLocalScheduleClick = (dateStr: string, scheduleIndex: number, schedule: BillingSalaryFormData) => {
    setLocalScheduleEditModal({
      isOpen: true,
      schedule,
      dateStr,
      scheduleIndex
    })
  }

  // 更新本地排程
  const handleUpdateLocalSchedule = (formData: BillingSalaryFormData) => {
    const { dateStr, scheduleIndex} = localScheduleEditModal
    setLocalSchedules(prev => {
      const newSchedules = { ...prev }
      if (newSchedules[dateStr]) {
        newSchedules[dateStr][scheduleIndex] = formData
      }
      return newSchedules
    })
    setLocalScheduleEditModal({
      isOpen: false,
      schedule: null,
      dateStr: '',
      scheduleIndex: -1
    })
    // 觸發社區券統計更新
    setVoucherUpdateTrigger(prev => prev + 1)
  }

  // 刪除本地排程（從模態框）
  const handleDeleteLocalScheduleFromModal = () => {
    const { dateStr, scheduleIndex } = localScheduleEditModal
    handleDeleteLocalSchedule(dateStr, scheduleIndex)
    setLocalScheduleEditModal({
      isOpen: false,
      schedule: null,
      dateStr: '',
      scheduleIndex: -1
    })
  }

  // 處理編輯本地排程 - 打開編輯表單
  const handleEditLocalSchedule = () => {
    const { dateStr, scheduleIndex, schedule } = localScheduleEditModal
    if (!schedule) return

    console.log('開始編輯本地排程:', {
      originalDate: dateStr,
      originalIndex: scheduleIndex,
      scheduleDate: schedule.service_date
    })

    // 設定編輯狀態
    setEditingLocalSchedule({
      originalDateStr: dateStr,
      originalIndex: scheduleIndex,
      schedule: schedule
    })

    // 設定選中的日期
    setSelectedDate(schedule.service_date)
    setSelectedDates([])
    setIsMultiSelectMode(false)

    // 關閉選項模態框，打開編輯表單
    setLocalScheduleEditModal({
      isOpen: false,
      schedule: null,
      dateStr: '',
      scheduleIndex: -1
    })
    setShowAddModal(true)
  }

  // 處理提交排班表單 - 添加到本地狀態
  const handleSubmitSchedule = async (formData: BillingSalaryFormData) => {
    setFormSubmitting(true)
    try {
      // 檢查是否為編輯模式
      if (editingLocalSchedule) {
        // 編輯模式：更新現有的本地排程
        const { originalDateStr, originalIndex } = editingLocalSchedule
        const newDate = formData.service_date

        console.log('編輯排程 - 原日期:', originalDateStr, '新日期:', newDate)

        setLocalSchedules(prev => {
          const newSchedules = { ...prev }

          // 從原日期移除排程
          if (newSchedules[originalDateStr]) {
            newSchedules[originalDateStr] = newSchedules[originalDateStr].filter((_, index) => index !== originalIndex)
            // 如果該日期沒有排程了，刪除整個日期鍵
            if (newSchedules[originalDateStr].length === 0) {
              delete newSchedules[originalDateStr]
            }
          }

          // 添加到新日期
          newSchedules[newDate] = [...(newSchedules[newDate] || []), formData]

          console.log('更新後的本地排程:', newSchedules)
          return newSchedules
        })

        alert('成功更新排班記錄')
        setEditingLocalSchedule(null) // 清除編輯狀態
      } else if (selectedDates.length > 1) {
        // 多日排班：為每個選定日期添加到本地狀態
        selectedDates.forEach(date => {
          const scheduleWithDate = { ...formData, service_date: date }
          setLocalSchedules(prev => ({
            ...prev,
            [date]: [...(prev[date] || []), scheduleWithDate]
          }))
        })

        alert(`成功添加 ${selectedDates.length} 筆排班記錄到月曆`)
      } else {
        // 單日排班
        const date = formData.service_date
        setLocalSchedules(prev => ({
          ...prev,
          [date]: [...(prev[date] || []), formData]
        }))

        alert('成功添加排班記錄到月曆')
      }

      // 關閉模態框並重置狀態
      setShowAddModal(false)
      setSelectedDate(null)
      setSelectedDates([])
      setIsMultiSelectMode(false)
    } catch (error) {
      console.error('處理排班失敗:', error)
      alert('處理排班失敗，請重試')
    } finally {
      setFormSubmitting(false)
    }
  }

  // 生成月曆數據
  const generateCalendarDays = () => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const firstDay = new Date(year, month, 1)
    const startDate = new Date(firstDay)
    startDate.setDate(startDate.getDate() - firstDay.getDay()) // 從週日開始

    const days = []
    const current = new Date(startDate)

    // 生成6週的日期（42天）
    for (let i = 0; i < 42; i++) {
      days.push(new Date(current))
      current.setDate(current.getDate() + 1)
    }

    return days
  }

  // 月份導航
  const navigateMonth = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate)
    newDate.setMonth(currentDate.getMonth() + (direction === 'next' ? 1 : -1))
    setCurrentDate(newDate)
  }

  // 處理日期點擊 - 新增排班
  const handleDateClick = (date: Date) => {
    const dateStr = formatDateSafely(date)

    if (isMultiSelectMode) {
      // 多選模式：切換日期選擇狀態
      if (selectedDates.includes(dateStr)) {
        setSelectedDates(prev => prev.filter(d => d !== dateStr))
      } else {
        setSelectedDates(prev => [...prev, dateStr])
      }
    } else {
      // 單選模式：直接開啟表單
      setSelectedDate(dateStr)
      setSelectedDates([dateStr])
      setShowAddModal(true)
    }
  }

  const calendarDays = generateCalendarDays()
  const currentMonth = currentDate.getMonth()

  return (
    <div className="space-y-8">
      {/* 月曆排班組件 */}
      <div className="card-apple border border-border-light fade-in-apple">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center space-x-4">
              {/* 選擇客戶按鈕 - 放在最左邊 */}
              <div className="relative">
                <button
                  onClick={() => setShowGlobalCustomerPicker(true)}
                  className={`px-4 py-2 rounded-xl border transition-all duration-300 flex items-center gap-2 ${
                    globalSelectedCustomer
                      ? 'bg-green-50 border-green-300 text-green-700'
                      : 'border-border-light hover:bg-bg-secondary text-text-secondary'
                  }`}
                >
                  <span>📋</span>
                  <span className="max-w-[120px] truncate">
                    {globalSelectedCustomer ? globalSelectedCustomer.customer_name : '選擇客戶'}
                  </span>
                  {globalSelectedCustomer && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setGlobalSelectedCustomer(null)
                      }}
                      className="ml-1 p-0.5 hover:bg-green-200 rounded-full transition-colors"
                      title="清除已選客戶"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </button>
              </div>

              <h3 className="text-apple-heading text-text-primary">月曆排班</h3>

              {/* 客戶篩選器 */}
              {getLocalCustomerNames().length > 0 && (
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-text-secondary">顯示客戶:</span>
                  <select
                    value={selectedCustomerFilter}
                    onChange={(e) => setSelectedCustomerFilter(e.target.value)}
                    className="form-input-apple pr-10 appearance-none cursor-pointer"
                  >
                    <option value="all">全部客戶</option>
                    {getLocalCustomerNames().map(customerName => (
                      <option key={customerName} value={customerName}>
                        {customerName}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* 多天排班控制 */}
            <div className="flex items-center gap-4">
              {/* 日曆導出按鈕 */}
              <button
                onClick={onCalendarExport}
                disabled={calendarExportLoading}
                className="btn-apple-secondary bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                title="導出 PDF 日曆報表"
              >
                {calendarExportLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    <span>產生中...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7v10a2 2 0 01-2 2H7a2 2 0 01-2-2V7m12 4l-4 4-4-4m4 4V3" />
                    </svg>
                    <span>導出日曆 PDF</span>
                  </>
                )}
              </button>

              {isMultiSelectMode && selectedDates.length > 0 && (
                <div className="text-sm text-text-secondary">
                  已選擇 {selectedDates.length} 天
                </div>
              )}

              {/* 顯示本地排程數量 */}
              {getTotalLocalSchedules() > 0 && (
                <div className="text-sm text-orange-600 font-medium">
                  {selectedCustomerFilter === 'all'
                    ? `待儲存 ${getTotalLocalSchedules()} 個排程`
                    : `${selectedCustomerFilter}: ${Object.values(getFilteredLocalSchedules()).reduce((total, daySchedules) => total + daySchedules.length, 0)} 個排程`
                  }
                </div>
              )}

              <button
                onClick={() => {
                  setIsMultiSelectMode(!isMultiSelectMode)
                  setSelectedDates([])
                  setSelectedDate(null)
                }}
                className={`px-4 py-2 rounded-xl border transition-all duration-300 ${
                  isMultiSelectMode
                    ? 'bg-primary text-white border-primary'
                    : 'border-border-light hover:bg-bg-secondary text-text-secondary'
                }`}
              >
                {isMultiSelectMode ? '取消多選' : '多天排班'}
              </button>

              {isMultiSelectMode && selectedDates.length > 0 && (
                <button
                  onClick={() => {
                    setShowAddModal(true)
                  }}
                  className="px-4 py-2 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-all duration-300"
                >
                  確認排班
                </button>
              )}

              {/* 確認儲存按鈕 */}
              {getTotalLocalSchedules() > 0 && (
                <button
                  onClick={handleSaveLocalSchedules}
                  disabled={formSubmitting}
                  className={`px-4 py-2 rounded-xl transition-all duration-300 ${
                    formSubmitting
                      ? 'bg-text-tertiary text-white cursor-not-allowed'
                      : 'bg-orange-600 text-white hover:bg-orange-700'
                  }`}
                >
                  {formSubmitting ? '儲存中...' :
                    selectedCustomerFilter === 'all' ? '確認儲存全部' : `儲存 ${selectedCustomerFilter}`
                  }
                </button>
              )}
            </div>
          </div>

          {/* 月份導航 */}
          <div className="flex justify-between items-center mb-6">
            <button
              onClick={() => navigateMonth('prev')}
              className="p-2 rounded-xl border border-border-light hover:bg-bg-secondary transition-all duration-300"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <h4 className="text-lg font-medium text-text-primary">
              {currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月 排班表
            </h4>

            <button
              onClick={() => navigateMonth('next')}
              className="p-2 rounded-xl border border-border-light hover:bg-bg-secondary transition-all duration-300"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* 週標題 */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['週日', '週一', '週二', '週三', '週四', '週五', '週六'].map((day) => (
              <div key={day} className="p-3 text-center text-sm font-medium text-text-secondary bg-bg-secondary rounded-xl">
                {day}
              </div>
            ))}
          </div>

          {/* 月曆格子 - 排班視圖 */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays && calendarDays.map((date, index) => {
              const dateStr = formatDateSafely(date)
              const isCurrentMonth = date.getMonth() === currentMonth
              const isToday = dateStr === formatDateSafely(new Date())
              const isWeekend = date.getDay() === 0 || date.getDay() === 6
              const holiday = isPublicHoliday(date)
              const isSelected = selectedDates.includes(dateStr)
              // 合併本地排程和遠端排程
              const remoteSchedules = scheduleData[dateStr] || []
              const filteredLocalSchedules = getFilteredLocalSchedules()
              const localDaySchedules = filteredLocalSchedules[dateStr] || []
              const allSchedules = [...remoteSchedules, ...localDaySchedules]

              // 根據排程數量動態調整高度 - 考慮文字換行需要更多空間
              const minHeight = allSchedules.length > 0
                ? Math.max(140, 140 + (allSchedules.length - 1) * 90)
                : 140

              return (
                <div
                  key={index}
                  onClick={() => isCurrentMonth && handleDateClick(date)}
                  style={{ minHeight: `${minHeight}px` }}
                  className={`
                    p-2 border-2 rounded-xl cursor-pointer
                    transition-all duration-300 hover:shadow-md
                    ${!isCurrentMonth ? 'bg-bg-secondary text-text-tertiary border-border-light' :
                      isSelected ? 'bg-green-100 border-green-500 border-2' :
                      holiday.isHoliday ? 'bg-red-50 border-red-300' :
                      isWeekend ? 'bg-blue-50 border-blue-200' : 'bg-bg-primary border-border-light'}
                    ${isToday ? 'ring-2 ring-primary border-primary' : ''}
                    hover:border-primary
                  `}
                >
                  <div className={`
                    text-lg font-bold mb-3 flex justify-between items-center
                    ${isToday ? 'text-primary' :
                      holiday.isHoliday ? 'text-red-600' :
                      isCurrentMonth ? 'text-text-primary' : 'text-text-tertiary'}
                  `}>
                    <div className="flex flex-col">
                      <span>{date.getDate()}</span>
                      {holiday.isHoliday && holiday.name && holiday.name !== '星期日' && (
                        <span className="text-xs text-red-500 font-normal truncate max-w-[80px]" title={holiday.name}>
                          {holiday.name.length > 5 ? holiday.name.substring(0, 5) + '..' : holiday.name}
                        </span>
                      )}
                    </div>
                    {isCurrentMonth && (
                      <span className="text-base text-green-600">
                        +
                      </span>
                    )}
                  </div>

                  {/* 排班內容 - 新格式 */}
                  {isCurrentMonth && (
                    <div className="space-y-2">
                      {/* 遠端排程 - 不可刪除 */}
                      {(remoteSchedules || []).map((schedule, i) => (
                        <div
                          key={`remote-${i}`}
                          className="text-base bg-white border border-border-light rounded p-3 shadow-sm"
                        >
                          {/* 第一行：客戶名稱/護理人員名稱 - 允許換行 */}
                          <div className="font-medium text-text-primary mb-2 text-base break-words leading-tight">
                            {schedule.customer_name}/{schedule.care_staff_name}
                          </div>

                          {/* 第二行：服務類型 - 允許換行 */}
                          <div className="text-blue-600 mb-2 text-base break-words leading-tight">
                            {schedule.service_type}
                          </div>

                          {/* 第三行：開始時間-結束時間 */}
                          <div className="text-text-secondary text-base font-medium">
                            {schedule.start_time}-{schedule.end_time}
                          </div>
                        </div>
                      ))}

                      {/* 本地排程 - 可點擊編輯/刪除 */}
                      {(localDaySchedules || []).map((schedule, i) => (
                        <div
                          key={`local-${i}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleLocalScheduleClick(dateStr, i, schedule)
                          }}
                          className="text-base bg-yellow-50 border-2 border-yellow-300 rounded p-3 shadow-sm cursor-pointer hover:bg-yellow-100 transition-colors relative group"
                        >
                          {/* 編輯按鈕提示 */}
                          <div className="absolute inset-0 bg-blue-500 bg-opacity-0 group-hover:bg-opacity-20 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                            <span className="text-blue-700 font-bold text-sm">點擊編輯</span>
                          </div>

                          {/* 第一行：客戶名稱/護理人員名稱 - 允許換行 */}
                          <div className="font-medium text-text-primary mb-2 text-base break-words leading-tight">
                            {schedule.customer_name}/{schedule.care_staff_name}
                          </div>

                          {/* 第二行：服務類型 - 允許換行 */}
                          <div className="text-blue-600 mb-2 text-base break-words leading-tight">
                            {schedule.service_type}
                          </div>

                          {/* 第三行：開始時間-結束時間 */}
                          <div className="text-text-secondary text-base font-medium">
                            {schedule.start_time}-{schedule.end_time}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* 排班說明 */}
      <div className="card-apple border border-border-light fade-in-apple">
        <div className="p-6">
          <h3 className="text-apple-heading text-text-primary mb-4">排班說明</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-blue-50 border-2 border-blue-200 rounded"></div>
              <span className="text-text-secondary">週末</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-primary rounded"></div>
              <span className="text-text-secondary">已安排服務</span>
            </div>
          </div>
        </div>
      </div>

      {/* 排班小結 */}
      <div className="card-apple border border-border-light fade-in-apple">
        <div className="p-6">
          <ScheduleSummaryView localSchedules={localSchedules} updateTrigger={voucherUpdateTrigger} />
        </div>
      </div>

      {/* 排班表單 Modal */}
      {showAddModal && (
        <ScheduleFormModal
          isOpen={showAddModal}
          onClose={() => {
            setShowAddModal(false)
            setSelectedDate(null)
            setSelectedDates([])
            setIsMultiSelectMode(false)
            setEditingLocalSchedule(null) // 清除編輯狀態
          }}
          selectedDate={selectedDate}
          selectedDates={selectedDates}
          existingRecord={editingLocalSchedule?.schedule ? {
            id: 'local-edit',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            service_date: editingLocalSchedule.schedule.service_date,
            customer_id: editingLocalSchedule.schedule.customer_id,
            customer_name: editingLocalSchedule.schedule.customer_name,
            phone: editingLocalSchedule.schedule.phone,
            service_address: editingLocalSchedule.schedule.service_address,
            start_time: editingLocalSchedule.schedule.start_time,
            end_time: editingLocalSchedule.schedule.end_time,
            service_hours: editingLocalSchedule.schedule.service_hours,
            staff_id: editingLocalSchedule.schedule.staff_id,
            care_staff_name: editingLocalSchedule.schedule.care_staff_name,
            service_fee: editingLocalSchedule.schedule.service_fee,
            staff_salary: editingLocalSchedule.schedule.staff_salary,
            hourly_rate: editingLocalSchedule.schedule.hourly_rate,
            hourly_salary: editingLocalSchedule.schedule.hourly_salary,
            service_type: editingLocalSchedule.schedule.service_type as any,
            project_category: editingLocalSchedule.schedule.project_category as any,
            project_manager: editingLocalSchedule.schedule.project_manager as any
          } : null}
          preselectedCustomer={editingLocalSchedule ? null : globalSelectedCustomer}
          onSubmit={handleSubmitSchedule}
        />
      )}

      {/* 本地排程編輯模態框 */}
      {localScheduleEditModal.isOpen && (
        <LocalScheduleEditModal
          isOpen={localScheduleEditModal.isOpen}
          schedule={localScheduleEditModal.schedule}
          onClose={() => setLocalScheduleEditModal({
            isOpen: false,
            schedule: null,
            dateStr: '',
            scheduleIndex: -1
          })}
          onUpdate={handleUpdateLocalSchedule}
          onDelete={handleDeleteLocalScheduleFromModal}
          onEdit={handleEditLocalSchedule}
        />
      )}

      {/* 全域客戶選擇器彈窗 */}
      {showGlobalCustomerPicker && (
        <div className="fixed inset-0 bg-black/50 z-[10001] flex items-center justify-center" onClick={() => setShowGlobalCustomerPicker(false)}>
          <div className="bg-white rounded-xl w-[90%] max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl z-[10002]" onClick={e => e.stopPropagation()}>
            {/* 彈窗標題 */}
            <div className="p-4 border-b border-border-light bg-bg-secondary">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold text-text-primary">📋 選擇客戶（排班前置）</h3>
                <button
                  type="button"
                  onClick={() => setShowGlobalCustomerPicker(false)}
                  className="p-1 hover:bg-bg-tertiary rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* 已選客戶提示 */}
              {globalSelectedCustomer && (
                <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
                  <span className="text-green-700 text-sm">
                    ✅ 已選: <strong>{globalSelectedCustomer.customer_name}</strong>
                  </span>
                  <button
                    onClick={() => setGlobalSelectedCustomer(null)}
                    className="text-green-600 hover:text-green-800 text-sm"
                  >
                    清除
                  </button>
                </div>
              )}

              {/* 篩選條件 */}
              <div className="flex flex-wrap gap-2">
                {/* 月份選擇 */}
                <input
                  type="month"
                  value={globalPickerMonth}
                  onChange={e => setGlobalPickerMonth(e.target.value)}
                  className="px-3 py-1.5 border border-border-light rounded-lg text-sm"
                />

                {/* 客戶類型 */}
                <select
                  value={globalPickerCategory}
                  onChange={e => setGlobalPickerCategory(e.target.value)}
                  className="px-3 py-1.5 border border-border-light rounded-lg text-sm"
                >
                  <option value="">全部類型</option>
                  {CUSTOMER_TYPE_OPTIONS.filter(opt => opt !== '家訪客戶').map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>

                {/* 所屬項目 */}
                <select
                  value={globalPickerProjectCategory}
                  onChange={e => setGlobalPickerProjectCategory(e.target.value)}
                  className="px-3 py-1.5 border border-border-light rounded-lg text-sm"
                >
                  <option value="">全部項目</option>
                  {PROJECT_CATEGORY_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>

                {/* 顯示全部/只顯示上月有服務 */}
                <button
                  type="button"
                  onClick={() => setGlobalPickerShowAll(!globalPickerShowAll)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    globalPickerShowAll
                      ? 'bg-gray-200 text-gray-700'
                      : 'bg-blue-500 text-white'
                  }`}
                >
                  {globalPickerShowAll ? '顯示全部' : '只顯示上月有服務'}
                </button>
              </div>
            </div>

            {/* 客戶列表 */}
            <div className="overflow-y-auto max-h-[50vh]">
              {globalPickerLoading ? (
                <div className="p-8 text-center text-text-secondary">
                  <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2"></div>
                  載入中...
                </div>
              ) : globalPickerCustomerList.length === 0 ? (
                <div className="p-8 text-center text-text-secondary">
                  沒有符合條件的客戶
                </div>
              ) : (
                <div className="divide-y divide-border-light">
                  {globalPickerCustomerList.map((customer, index) => (
                    <div
                      key={customer.customer_id || index}
                      onClick={() => {
                        setGlobalSelectedCustomer({
                          customer_id: customer.customer_id,
                          customer_name: customer.customer_name,
                          phone: customer.phone,
                          service_address: customer.service_address,
                          project_category: customer.project_category
                        })
                        setShowGlobalCustomerPicker(false)
                      }}
                      className={`p-3 hover:bg-bg-secondary cursor-pointer transition-colors ${
                        globalSelectedCustomer?.customer_id === customer.customer_id ? 'bg-green-50' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-text-primary">{customer.customer_name}</span>
                            {customer.hasLastMonthService && (
                              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">上月有服務</span>
                            )}
                            {customer.currentMonthScheduleCount > 0 ? (
                              <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded">
                                本月已排 {customer.currentMonthScheduleCount} 更
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 text-xs rounded">本月未排更</span>
                            )}
                          </div>
                          <div className="text-xs text-text-secondary mt-1">
                            {customer.customer_id && <span className="mr-2">{customer.customer_id}</span>}
                            {customer.phone && <span className="mr-2">📞 {customer.phone}</span>}
                          </div>
                          <div className="text-xs text-text-tertiary mt-0.5 truncate">
                            📍 {customer.service_address || '未設定地址'}
                          </div>
                        </div>
                        <div className="text-right text-xs">
                          <div className="text-text-secondary">{customer.customer_type}</div>
                          {customer.project_category && (
                            <div className="text-text-tertiary">{customer.project_category}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 底部說明 */}
            <div className="p-3 border-t border-border-light bg-bg-secondary text-xs text-text-secondary">
              💡 選擇客戶後，點擊月曆日期新增排班時會自動填入客戶資料
            </div>
          </div>
        </div>
      )}

      {/* 儲存後導出日曆 PDF 提示彈窗 */}
      {showExportPrompt && (
        <div className="fixed inset-0 bg-black/50 z-[10001] flex items-center justify-center" onClick={() => setShowExportPrompt(false)}>
          <div className="bg-white rounded-2xl w-[90%] max-w-md overflow-hidden shadow-2xl z-[10002] animate-in fade-in zoom-in-95 relative" onClick={e => e.stopPropagation()}>
            
            {/* Step 1: 問是否要導出 */}
            {exportPromptStep === 'ask' && (
              <>
                <div className="p-6 pb-2 text-center">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-3xl">✅</span>
                  </div>
                  <h3 className="text-lg font-bold text-text-primary mb-2">排程儲存成功！</h3>
                  <p className="text-sm text-text-secondary">
                    {savedCustomerNames.length > 0 && (
                      <span className="block mb-1">
                        客戶：{savedCustomerNames.length <= 2 ? savedCustomerNames.join('、') : `${savedCustomerNames[0]} 等 ${savedCustomerNames.length} 位`}
                      </span>
                    )}
                    需要導出剛才入更的日曆 PDF 嗎？
                  </p>
                </div>
                <div className="p-4 flex gap-3">
                  <button
                    onClick={() => setShowExportPrompt(false)}
                    className="flex-1 px-4 py-3 rounded-xl border border-border-light text-text-secondary hover:bg-bg-secondary transition-all duration-200 font-medium"
                  >
                    唔需要
                  </button>
                  <button
                    onClick={() => setExportPromptStep('nameMode')}
                    className="flex-1 px-4 py-3 rounded-xl bg-primary text-white hover:bg-primary/90 transition-all duration-200 font-medium shadow-lg shadow-primary/25"
                  >
                    要，導出 PDF
                  </button>
                </div>
              </>
            )}

            {/* Step 2: 選擇 PDF 檔案名稱模式 */}
            {exportPromptStep === 'nameMode' && (
              <>
                <div className="p-6 pb-2">
                  <div className="flex items-center gap-3 mb-4">
                    <button
                      onClick={() => setExportPromptStep('ask')}
                      className="p-1 hover:bg-bg-secondary rounded-lg transition-colors"
                    >
                      <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <h3 className="text-lg font-bold text-text-primary">PDF 檔案名稱</h3>
                  </div>
                  <p className="text-sm text-text-secondary mb-4">
                    請選擇 PDF 檔案名稱使用邊個名稱：
                  </p>
                  <div className="space-y-3">
                    <button
                      onClick={() => handleNameModeSelect('customer')}
                      disabled={exportingCalendar}
                      className="w-full p-4 rounded-xl border-2 border-border-light hover:border-primary hover:bg-primary/5 transition-all duration-200 text-left group disabled:opacity-50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                          <span className="text-xl">👤</span>
                        </div>
                        <div>
                          <div className="font-medium text-text-primary">客戶名稱</div>
                          <div className="text-xs text-text-secondary mt-0.5">
                            {savedCustomerNames.length > 0
                              ? `例如：${savedCustomerNames[0]} ...更表`
                              : '以客戶名稱作為檔案名稱'}
                          </div>
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => handleNameModeSelect('staff')}
                      disabled={exportingCalendar}
                      className="w-full p-4 rounded-xl border-2 border-border-light hover:border-purple-500 hover:bg-purple-50 transition-all duration-200 text-left group disabled:opacity-50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center group-hover:bg-purple-200 transition-colors">
                          <span className="text-xl">👨‍⚕️</span>
                        </div>
                        <div>
                          <div className="font-medium text-text-primary">護理人員名稱</div>
                          <div className="text-xs text-text-secondary mt-0.5">
                            {savedStaffNames.length > 0
                              ? `例如：${savedStaffNames[0]} ...更表${savedStaffNames.length > 1 ? `（共 ${savedStaffNames.length} 位）` : ''}`
                              : '以護理人員名稱作為檔案名稱'}
                          </div>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
                <div className="p-4 pt-2">
                  <button
                    onClick={() => setShowExportPrompt(false)}
                    className="w-full px-4 py-2 text-sm text-text-tertiary hover:text-text-secondary transition-colors"
                  >
                    取消
                  </button>
                </div>

                {/* 導出中遮罩 */}
                {exportingCalendar && (
                  <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-2xl">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-3 border-primary border-t-transparent mx-auto mb-2"></div>
                      <p className="text-sm text-text-secondary">正在產生日曆 PDF...</p>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Step 3: 選擇護理人員（多位時） */}
            {exportPromptStep === 'staffPicker' && (
              <>
                <div className="p-6 pb-2">
                  <div className="flex items-center gap-3 mb-4">
                    <button
                      onClick={() => setExportPromptStep('nameMode')}
                      className="p-1 hover:bg-bg-secondary rounded-lg transition-colors"
                    >
                      <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <h3 className="text-lg font-bold text-text-primary">選擇護理人員</h3>
                  </div>
                  <p className="text-sm text-text-secondary mb-4">
                    排程中有 {savedStaffNames.length} 位護理人員，請選擇要用邊位嘅名稱：
                  </p>
                  <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                    {savedStaffNames.map((staffName, index) => (
                      <button
                        key={index}
                        onClick={() => {
                          setSelectedExportStaff(staffName)
                          handleExportAfterSaveWithParams(savedScheduleFilters!, 'staff', staffName)
                        }}
                        disabled={exportingCalendar}
                        className="w-full p-3 rounded-xl border border-border-light hover:border-purple-500 hover:bg-purple-50 transition-all duration-200 text-left flex items-center gap-3 disabled:opacity-50"
                      >
                        <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <span className="text-sm">👨‍⚕️</span>
                        </div>
                        <div>
                          <div className="font-medium text-text-primary text-sm">{staffName}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="p-4 pt-2">
                  <button
                    onClick={() => setShowExportPrompt(false)}
                    className="w-full px-4 py-2 text-sm text-text-tertiary hover:text-text-secondary transition-colors"
                  >
                    取消
                  </button>
                </div>

                {/* 導出中遮罩 */}
                {exportingCalendar && (
                  <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-2xl">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-3 border-primary border-t-transparent mx-auto mb-2"></div>
                      <p className="text-sm text-text-secondary">正在產生日曆 PDF...</p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// 報表頁面組件
function ReportsTab({ filters, setFilters, updateDateRange, exportLoading, handleExport, onCalendarExport, calendarExportLoading, onEdit, onDelete, refreshTrigger, onRefresh, recordUpdateTimes }: ReportsTabProps) {
  const [careStaffList, setCareStaffList] = useState<{ name_chinese: string }[]>([])
  const [careStaffLoading, setCareStaffLoading] = useState(true)

  // 客戶搜尋相關狀態
  const [customerSearchTerm, setCustomerSearchTerm] = useState('')
  const [customerSuggestions, setCustomerSuggestions] = useState<CustomerSearchResult[]>([])
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false)
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false)
  const [selectedCustomers, setSelectedCustomers] = useState<CustomerSearchResult[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 })

  // 項目分類下拉選單狀態
  const [isProjectCategoryDropdownOpen, setIsProjectCategoryDropdownOpen] = useState(false)

  const selectedProjectCategories = Array.isArray(filters.projectCategory)
    ? filters.projectCategory
    : filters.projectCategory
    ? [filters.projectCategory]
    : []

  // 計算下拉選單位置
  const updateDropdownPosition = () => {
    if (searchInputRef.current) {
      const rect = searchInputRef.current.getBoundingClientRect()
      setDropdownPosition({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width
      })
    }
  }

  // 點擊外部關閉下拉選單
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.customer-search-container')) {
        setShowCustomerSuggestions(false)
      }
      if (!target.closest('.project-category-dropdown')) {
        setIsProjectCategoryDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 載入護理人員列表
  useEffect(() => {
    loadCareStaffList()
  }, [])

  const loadCareStaffList = async () => {
    try {
      setCareStaffLoading(true)
      const response = await getAllCareStaff()
      if (response.success && response.data) {
        setCareStaffList(response.data || [])
      }
    } catch (error) {
      console.error('載入護理人員列表失敗:', error)
    } finally {
      setCareStaffLoading(false)
    }
  }

  // 客戶搜尋函數
  const handleCustomerSearch = async (searchTerm: string) => {
    console.log('客戶搜尋開始:', searchTerm) // 除錯輸出

    if (searchTerm.length < 1) {
      setCustomerSuggestions([])
      setShowCustomerSuggestions(false)
      return
    }

    try {
      setCustomerSearchLoading(true)
      console.log('使用 Supabase 直接進行客戶搜尋') // 調試日誌

      // 直接使用 Supabase 客戶端查詢（正確的表名和欄位名）
      const { data, error } = await supabase
        .from('customer_personal_data')
        .select('customer_id, customer_name, phone, service_address')
        .or(`customer_name.ilike.%${searchTerm.trim()}%,customer_id.ilike.%${searchTerm.trim()}%,phone.ilike.%${searchTerm.trim()}%,service_address.ilike.%${searchTerm.trim()}%`)
        .limit(10)

      if (error) {
        console.error('Supabase 客戶搜尋錯誤:', error)
        setCustomerSuggestions([])
        setShowCustomerSuggestions(false)
        return
      }

      const results = (data || []).map((item: any) => ({
        customer_id: item.customer_id || '',
        customer_name: item.customer_name || '',
        phone: item.phone || '',
        service_address: item.service_address || '',
        display_text: item.customer_name || '',
        type: 'customer' as const
      }))

      console.log('客戶搜尋結果:', results) // 調試日誌
      setCustomerSuggestions(results)
      setShowCustomerSuggestions(true)
      console.log('設定建議列表:', results.length, '筆資料') // 除錯輸出

    } catch (error) {
      console.error('客戶搜尋失敗:', error)
      setCustomerSuggestions([])
      setShowCustomerSuggestions(false)
    } finally {
      setCustomerSearchLoading(false)
    }
  }

  // 選擇客戶 (單選)
  const selectCustomer = (customer: CustomerSearchResult) => {
    setCustomerSearchTerm(customer.display_text)
    setFilters(prev => ({
      ...prev,
      searchTerm: customer.customer_name
    }))
    setShowCustomerSuggestions(false)
  }

  // 切換客戶選擇狀態 (多選)
  const toggleCustomerSelection = (customer: CustomerSearchResult) => {
    console.log('切換客戶選擇:', customer.customer_name) // 除錯輸出
    setSelectedCustomers(prev => {
      const isSelected = prev.some(c => c.customer_id === customer.customer_id)
      let newSelection

      if (isSelected) {
        newSelection = (prev || []).filter(c => c.customer_id !== customer.customer_id)
        console.log('移除客戶:', customer.customer_name) // 除錯輸出
      } else {
        newSelection = [...(prev || []), customer]
        console.log('新增客戶:', customer.customer_name) // 除錯輸出
      }

      return newSelection
    })

    // 選擇客戶後不要立即隱藏下拉選單，讓用戶可以繼續選擇
    // setCustomerSearchTerm('')
    // setShowCustomerSuggestions(false)
  }

  // 當選中客戶變化時，更新篩選條件
  useEffect(() => {
    if (selectedCustomers && selectedCustomers.length > 0) {
      // 使用選中客戶的 ID 陣列進行精確搜尋
      const customerIds = (selectedCustomers || []).map(c => c?.customer_id).filter(id => id)
      setFilters(prevFilters => ({
        ...prevFilters,
        selectedCustomerIds: customerIds,
        searchTerm: '' // 清空模糊搜尋條件
      }))
      console.log('設定客戶篩選條件:', customerIds) // 除錯輸出
    } else {
      // 沒有選中客戶時，清空客戶篩選條件
      setFilters(prevFilters => ({
        ...prevFilters,
        selectedCustomerIds: undefined,
        searchTerm: ''
      }))
      console.log('清除客戶篩選條件') // 除錯輸出
    }
  }, [selectedCustomers])

  // 移除選中的客戶
  const removeSelectedCustomer = (customer: CustomerSearchResult) => {
    toggleCustomerSelection(customer)
  }

  // 處理搜尋輸入變化
  const handleCustomerSearchChange = (value: string) => {
    setCustomerSearchTerm(value)

    // 只在沒有選中客戶時才直接更新篩選條件
    if (!selectedCustomers || selectedCustomers.length === 0) {
      setFilters(prev => ({
        ...prev,
        searchTerm: value
      }))
    }

    // 觸發搜尋建議（降低門檻，輸入1個字符就開始搜尋）
    if (value.length >= 1) {
      updateDropdownPosition() // 更新位置
      handleCustomerSearch(value)
    } else {
      // 清空建議並隱藏下拉選單
      setCustomerSuggestions([])
      setShowCustomerSuggestions(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* 搜尋與篩選 - 提升 z-index 確保下拉選單不被覆蓋 */}
      <div className="card-apple mb-4 sm:mb-6 fade-in-apple relative z-50" style={{ overflow: 'visible' }}>
        <div className="card-apple-header border-b border-border-light">
          <div className="flex items-center justify-between">
            <h3 className="text-lg sm:text-xl font-semibold text-text-primary">搜尋與篩選</h3>
            {/* 快捷按鈕移到右邊 */}
            <div className="flex space-x-2">
              <button
                onClick={() => {
                  const today = formatDateSafely(new Date())
                  setFilters(prev => ({
                    ...prev,
                    dateRange: { start: today, end: today }
                  }))
                }}
                className="btn-apple-secondary text-xs sm:text-sm"
              >
                今日
              </button>
              <button
                onClick={() => updateDateRange('thisMonth')}
                className="btn-apple-primary text-xs sm:text-sm"
              >
                本月
              </button>
            </div>
          </div>
        </div>
        <div className="card-apple-content" style={{ overflow: 'visible' }}>
          {/* 日期區間 - 獨立一行更清晰 */}
          <div className="flex flex-wrap items-center gap-3 mb-5 pb-5 border-b border-border-light">
            <span className="text-sm font-medium text-text-secondary">日期範圍</span>
            <div className="flex items-center gap-2 bg-bg-secondary rounded-xl px-4 py-2">
              <input
                type="date"
                value={filters.dateRange?.start || ''}
                onChange={(e) => setFilters(prev => ({
                  ...prev,
                  dateRange: { ...prev.dateRange, start: e.target.value }
                }))}
                className="bg-transparent border-none text-sm text-text-primary focus:outline-none focus:ring-0"
              />
              <span className="text-text-tertiary">至</span>
              <input
                type="date"
                value={filters.dateRange?.end || ''}
                onChange={(e) => setFilters(prev => ({
                  ...prev,
                  dateRange: { ...prev.dateRange, end: e.target.value }
                }))}
                className="bg-transparent border-none text-sm text-text-primary focus:outline-none focus:ring-0"
              />
            </div>
          </div>

          {/* 篩選條件 - 網格佈局 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4" style={{ overflow: 'visible' }}>
            {/* 客戶搜尋 */}
            <div className="relative z-50" style={{ overflow: 'visible' }}>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">客戶</label>
              <div className="relative customer-search-container" style={{ overflow: 'visible' }}>
                <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="姓名/編號/電話"
                  value={customerSearchTerm}
                  onChange={(e) => handleCustomerSearchChange(e.target.value)}
                  onFocus={() => {
                    console.log('輸入框被點擊')
                    updateDropdownPosition()
                    if (customerSearchTerm.length >= 1) {
                      if (customerSuggestions.length > 0) {
                        setShowCustomerSuggestions(true)
                      } else {
                        handleCustomerSearch(customerSearchTerm)
                      }
                    }
                  }}
                  onBlur={() => {
                    console.log('輸入框失去焦點')
                    setTimeout(() => {
                      setShowCustomerSuggestions(false)
                    }, 150)
                  }}
                  className="w-full pl-9 pr-4 py-2.5 bg-bg-secondary border border-border-light rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                />

                {/* 客戶搜尋建議下拉選單 - 使用 Portal + 移動端優化 */}
                {showCustomerSuggestions && typeof window !== 'undefined' && createPortal(
                  <div
                    className="fixed bg-white border border-border-light rounded-xl shadow-2xl max-h-48 overflow-y-auto z-[9999]"
                    style={{
                      top: `${Math.min(dropdownPosition.top, window.innerHeight - 250)}px`,
                      left: `${Math.max(8, Math.min(dropdownPosition.left, window.innerWidth - dropdownPosition.width - 8))}px`,
                      width: `${Math.min(dropdownPosition.width, window.innerWidth - 16)}px`,
                      backgroundColor: '#ffffff',
                      border: '1px solid #e5e7eb'
                    }}
                    onMouseDown={(e) => {
                      console.log('下拉選單被點擊') // 除錯輸出
                      e.preventDefault() // 防止 blur 事件觸發
                    }}
                  >
                    {customerSearchLoading ? (
                      <div className="p-3 text-center text-text-secondary">
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent mx-auto"></div>
                      </div>
                    ) : customerSuggestions && customerSuggestions.length > 0 ? (
                      customerSuggestions.map((customer, index) => (
                        <div
                          key={`${customer.customer_id}-${index}`}
                          className="p-3 hover:bg-bg-secondary cursor-pointer border-b border-border-light last:border-b-0 flex items-center transition-colors"
                          onMouseDown={(e) => {
                            console.log('選項被點擊:', customer.customer_name) // 除錯輸出
                            e.preventDefault()
                            e.stopPropagation()
                            toggleCustomerSelection(customer)
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedCustomers.some(c => c.customer_id === customer.customer_id)}
                            className="mr-3 rounded border-border-light focus:ring-primary pointer-events-none"
                            readOnly
                          />
                          <div className="flex-1">
                            <div className="font-medium text-text-primary">{customer.customer_name}</div>
                            <div className="text-sm text-text-secondary">
                              {customer.customer_id} {customer.phone && `• ${customer.phone}`}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-3 text-center text-text-secondary text-sm">
                        沒有找到相關客戶
                      </div>
                    )}
                  </div>,
                  document.body
                )}
              </div>

              {/* 選中客戶的 chips 顯示 */}
              {selectedCustomers && selectedCustomers.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedCustomers && selectedCustomers.map((customer) => (
                    <div
                      key={customer.customer_id}
                      className="inline-flex items-center bg-primary text-white text-xs px-2.5 py-1 rounded-full"
                    >
                      <span className="mr-1.5 truncate max-w-[100px]">
                        {customer.customer_name}
                      </span>
                      <button
                        onClick={() => removeSelectedCustomer(customer)}
                        className="hover:bg-white/20 rounded-full p-0.5"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 所屬項目 */}
            <div className="relative z-40" style={{ overflow: 'visible' }}>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">所屬項目</label>
              <div className="relative project-category-dropdown">
                <div
                  className="w-full px-3 py-2.5 bg-bg-secondary border border-border-light rounded-xl text-sm cursor-pointer flex items-center min-h-[42px]"
                  onClick={() => setIsProjectCategoryDropdownOpen(!isProjectCategoryDropdownOpen)}
                >
                  <div className="flex flex-wrap gap-1 flex-1">
                    {selectedProjectCategories.length > 0 ? (
                      selectedProjectCategories.map(category => {
                        const option = PROJECT_CATEGORY_OPTIONS.find(opt => opt.value === category)
                        return (
                          <span
                            key={category}
                            className="inline-flex items-center px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-lg font-medium"
                          >
                            <span className="truncate max-w-[60px]">{option?.label}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setFilters(prev => {
                                  const prevCategories = Array.isArray(prev.projectCategory)
                                    ? prev.projectCategory
                                    : prev.projectCategory
                                    ? [prev.projectCategory]
                                    : []
                                  return {
                                    ...prev,
                                    projectCategory: prevCategories.filter(c => c !== category)
                                  }
                                })
                              }}
                              className="ml-1 text-primary hover:text-red-500"
                            >
                              ×
                            </button>
                          </span>
                        )
                      })
                    ) : (
                      <span className="text-text-tertiary text-sm">可多選</span>
                    )}
                  </div>
                </div>
                <svg className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none transition-transform duration-200" style={{ transform: isProjectCategoryDropdownOpen ? 'translateY(-50%) rotate(180deg)' : 'translateY(-50%)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>

                {isProjectCategoryDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border-light rounded-xl shadow-2xl z-[100] max-h-56 overflow-y-auto">
                    {PROJECT_CATEGORY_OPTIONS.map(option => {
                      const isSelected = selectedProjectCategories.includes(option.value)
                      return (
                        <div
                          key={option.value}
                          className={`px-3 py-2.5 cursor-pointer hover:bg-bg-secondary flex items-center justify-between text-sm transition-colors ${
                            isSelected ? 'bg-primary/5 text-primary font-medium' : 'text-text-primary'
                          }`}
                          onClick={() => {
                            setFilters(prev => {
                              const prevCategories = Array.isArray(prev.projectCategory)
                                ? prev.projectCategory
                                : prev.projectCategory
                                ? [prev.projectCategory]
                                : []
                              const newCategories = isSelected
                                ? prevCategories.filter(c => c !== option.value)
                                : [...prevCategories, option.value]
                              return {
                                ...prev,
                                projectCategory: newCategories
                              }
                            })
                          }}
                        >
                          <span className="truncate">{option.label}</span>
                          {isSelected && (
                            <svg className="w-4 h-4 text-primary flex-shrink-0 ml-2" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* 服務類型 */}
            <div className="relative z-30">
              <label className="block text-xs font-medium text-text-secondary mb-1.5">服務類型</label>
              <div className="relative">
                <select
                  value={filters.serviceType || ''}
                  onChange={(e) => setFilters(prev => ({
                    ...prev,
                    serviceType: e.target.value as ServiceType | undefined
                  }))}
                  className="w-full px-3 py-2.5 bg-bg-secondary border border-border-light rounded-xl text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                >
                  <option value="">全部</option>
                  {SERVICE_TYPE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <svg className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* 護理人員 */}
            <div className="relative z-20">
              <label className="block text-xs font-medium text-text-secondary mb-1.5">護理人員</label>
              <CareStaffSearchableSelect
                careStaffList={careStaffList}
                value={filters.careStaffName || ''}
                onChange={(value) => setFilters(prev => ({
                  ...prev,
                  careStaffName: value
                }))}
                loading={careStaffLoading}
                placeholder="全部"
              />
            </div>

            {/* 介紹人篩選 */}
            <div className="relative z-10">
              <label className="block text-xs font-medium text-text-secondary mb-1.5">介紹人</label>
              <div className="relative">
                <select
                  value={filters.introducer || ''}
                  onChange={(e) => setFilters(prev => ({
                    ...prev,
                    introducer: e.target.value as Introducer | undefined || undefined
                  }))}
                  className="w-full px-3 py-2.5 bg-bg-secondary border border-border-light rounded-xl text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                >
                  <option value="">全部</option>
                  {INTRODUCER_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <svg className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 服務記錄列表 - z-index 設為 10，確保低於搜尋區域的下拉選單 */}
      <div className="card-apple border border-border-light fade-in-apple relative z-10">
        <div className="p-4 sm:p-6">
          {/* 標題和操作按鈕 - 改進佈局 */}
          <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center mb-6 gap-4">
            <div className="flex items-center gap-4">
              <h3 className="text-lg font-semibold text-text-primary">服務記錄</h3>
              <span className="text-sm text-text-tertiary">
                {(() => {
                  const [year, month] = filters.dateRange.start.split('-').map(Number)
                  return `${year}年${month}月`
                })()}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* 導出按鈕 */}
              <button
                onClick={onCalendarExport}
                disabled={calendarExportLoading}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-text-primary bg-white border border-border-light rounded-xl hover:bg-bg-secondary transition-colors disabled:opacity-50"
                title="導出 PDF 日曆報表"
              >
                {calendarExportLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent"></div>
                    <span>產生中...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    <span>導出日曆 PDF</span>
                  </>
                )}
              </button>

              <button
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleExport()
                }}
                disabled={exportLoading}
                className="btn-apple-primary text-sm disabled:opacity-50"
              >
                {exportLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                    <span>導出中...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span>導出報表</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 服務記錄顯示 */}
          <ReportsCalendarView 
            filters={filters} 
            onEdit={onEdit} 
            onDelete={onDelete} 
            refreshTrigger={refreshTrigger} 
            recordUpdateTimes={recordUpdateTimes}
          />

          {/* 社區券機數統計 */}
          <div className="mt-8">
            <div className="card-apple border border-border-light fade-in-apple">
              <div className="p-6">
                <VoucherSummaryView filters={filters} refreshTrigger={refreshTrigger} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ServicesPage() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [kpiLoading, setKpiLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [calendarExportLoading, setCalendarExportLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'schedule' | 'reports'>('reports')
  const router = useRouter()

  // 支援 Dashboard 深連結：/services?tab=schedule
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const tab = params.get('tab')
      if (tab === 'overview' || tab === 'schedule' || tab === 'reports') {
        setActiveTab(tab)
      }
    } catch {
      // ignore
    }
  }, [])

  // 狀態管理
  const [filters, setFilters] = useState<BillingSalaryFilters>(() => {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)

    return {
      dateRange: {
        start: formatDateLocal(startOfMonth),
        end: formatDateLocal(endOfMonth)
      },
      projectCategory: [] // 初始化為空陣列
    }
  })

  const [kpiData, setKpiData] = useState<BusinessKPI | null>(null)
  const [categorySummary, setCategorySummary] = useState<ProjectCategorySummary[]>([])

  // 編輯相關狀態
  const [editingRecord, setEditingRecord] = useState<BillingSalaryRecord | null>(null)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)

  // 刷新觸發器
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  // 最後更新時間狀態
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null)
  
  // 追蹤每個記錄的更新時間
  const [recordUpdateTimes, setRecordUpdateTimes] = useState<Record<string, Date>>({})

  // 從 localStorage 載入所有服務記錄的更新時間（頁面載入時和刷新時）
  useEffect(() => {
    const loadRecordUpdateTimes = () => {
      const times: Record<string, Date> = {}
      const now = new Date()
      
      console.log('🔍 開始掃描 localStorage 中的記錄更新時間...')
      
      // 遍歷所有 localStorage 項目，找出服務記錄更新時間
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith('service_update_')) {
          const recordId = key.replace('service_update_', '')
          const timeStr = localStorage.getItem(key)
          if (timeStr) {
            let updateTime: Date
            
            // 🔧 支持兩種時間格式：數字時間戳和ISO字符串
            if (timeStr.includes('T') && timeStr.includes('Z')) {
              // ISO字符串格式 (如: 2025-09-21T06:18:03.798Z)
              updateTime = new Date(timeStr)
            } else {
              // 數字時間戳格式 (如: "1726898283798")
              const timeNum = parseInt(timeStr, 10)
              if (isNaN(timeNum)) {
                console.warn('⚠️ 無效的時間格式，跳過記錄:', { key, timeStr })
                continue
              }
              updateTime = new Date(timeNum)
            }
            
            // 檢查 Date 對象是否有效
            if (isNaN(updateTime.getTime())) {
              console.warn('⚠️ 無效的Date對象，跳過記錄:', { key, timeStr })
              continue
            }
            
            const diffInMinutes = (now.getTime() - updateTime.getTime()) / (1000 * 60)
            
            console.log('📝 找到記錄更新時間:', {
              recordId,
              updateTime: updateTime.toISOString(),
              diffInMinutes: Math.round(diffInMinutes * 100) / 100
            })
            
            // 只加載30分鐘內的更新時間
            if (diffInMinutes < 30) {
              times[recordId] = updateTime
              console.log('✅ 記錄在30分鐘內，已加載')
            } else {
              // 清除超過30分鐘的舊記錄
              localStorage.removeItem(key)
              console.log('🗑️ 記錄超過30分鐘，已清除')
            }
          }
        }
      }
      
      console.log('🔄 載入記錄更新時間完成，總共載入:', Object.keys(times).length, '筆記錄')
      console.log('📊 載入的記錄更新時間:', times)
      setRecordUpdateTimes(times)
      console.log('✅ setRecordUpdateTimes 已調用，期望觸發重新渲染')
    }

    loadRecordUpdateTimes()
  }, [refreshTrigger]) // 添加 refreshTrigger 作為依賴

  // 監聽服務記錄更新事件
  useEffect(() => {
    const handleRecordUpdate = (event: any) => {
      if (event?.detail?.recordId) {
        // 處理自定義事件
        const recordId = event.detail.recordId
        const timeStr = localStorage.getItem(`service_update_${recordId}`)
        if (timeStr) {
          let updateTime: Date
          
          // 🔧 支持兩種時間格式：數字時間戳和ISO字符串
          if (timeStr.includes('T') && timeStr.includes('Z')) {
            // ISO字符串格式
            updateTime = new Date(timeStr)
          } else {
            // 數字時間戳格式
            const timeNum = parseInt(timeStr, 10)
            if (isNaN(timeNum)) {
              console.warn('⚠️ 事件處理器: 無效的時間格式', { recordId, timeStr })
              return
            }
            updateTime = new Date(timeNum)
          }
          
          if (!isNaN(updateTime.getTime())) {
            setRecordUpdateTimes(prev => ({
              ...prev,
              [recordId]: updateTime
            }))
            console.log('🔔 事件處理器更新記錄時間:', {
              recordId,
              updateTime: updateTime.toISOString()
            })
            console.log('🔄 事件處理器 setRecordUpdateTimes 已調用，期望觸發重新渲染')
            
            // 強制觸發 ReportsCalendarView 重新渲染
            setRefreshTrigger(prev => prev + 1)
            console.log('🔃 觸發 refreshTrigger 以強制重新渲染組件')
          }
        }
      }
    }

    const handleStorageUpdate = () => {
      // 處理 storage 事件或頁面載入時的檢查
      const updatedRecordInfo = localStorage.getItem('recordUpdated')
      if (updatedRecordInfo) {
        const { recordId, updateTime } = JSON.parse(updatedRecordInfo)
        setRecordUpdateTimes(prev => ({
          ...prev,
          [recordId]: new Date(updateTime)
        }))
        localStorage.removeItem('recordUpdated')
      }
    }

    // 檢查頁面載入時是否有更新
    handleStorageUpdate()

    // 監聽 storage 事件
    window.addEventListener('storage', handleStorageUpdate)
    
    // 監聽自定義事件（同頁面內的更新）
    window.addEventListener('recordUpdated', handleRecordUpdate)

    return () => {
      window.removeEventListener('storage', handleStorageUpdate)
      window.removeEventListener('recordUpdated', handleRecordUpdate)
    }
  }, [])
  // 導出相關狀態
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportFormat, setExportFormat] = useState<'csv' | 'pdf'>('pdf')
  const [exportMode, setExportMode] = useState<'accounting' | 'payroll'>('accounting')
  const [payrollExportType, setPayrollExportType] = useState<'separate' | 'combined'>('combined') // 工資模式的子選項

  // 護理員分開PDF頁面狀態
  const [showStaffListPage, setShowStaffListPage] = useState(false)
  const [staffDownloadStatus, setStaffDownloadStatus] = useState<Record<string, string>>({}) // 記錄每個護理員的下載狀態 ('idle' | 'downloading' | 'downloaded' | 'error')
  const [staffList, setStaffList] = useState<StaffOption[]>([])
  const [loadingStaff, setLoadingStaff] = useState(true)

  // 默認選中的欄位：1.服務日期 2.客戶姓名 3.服務地址 4.服務類型 5.開始時間-結束時間 6.時數 7.護理員姓名
  const [exportColumns, setExportColumns] = useState({
    service_date: true,      // 1. 服務日期 (默認)
    customer_id: false,
    customer_name: true,     // 2. 客戶姓名 (默認)
    phone: false,
    service_address: true,   // 3. 服務地址 (默認)
    start_time: true,        // 5. 開始時間 (默認)
    end_time: true,          // 5. 結束時間 (默認)
    service_hours: true,     // 6. 時數 (默認)
    care_staff_name: true,   // 7. 護理員姓名 (默認)
    staff_id: false,
    service_fee: false,
    staff_salary: false,
    service_profit: false,   // 新增：服務利潤
    hourly_rate: false,
    hourly_salary: false,
    service_type: true,      // 4. 服務類型 (默認)
    project_category: false,
    project_manager: false,
  })

  // 預設模式配置
  const exportModeConfigs = {
    accounting: {
      name: '對數模式',
      description: '包含服務費用和收費相關欄位',
      columns: {
        service_date: true,
        customer_name: true,
        service_address: true,
        start_time: true,
        end_time: true,
        service_hours: true,
        care_staff_name: true,
        staff_id: false,
        service_type: true,
        service_fee: true,      // 對數模式自動包含
        service_profit: true,   // 對數模式自動包含：服務利潤
        hourly_rate: true,      // 對數模式自動包含
        customer_id: false,
        phone: false,
        staff_salary: false,
        hourly_salary: false,
        project_category: false,
        project_manager: false,
      }
    },
    payroll: {
      name: '工資模式',
      description: '包含護理員工資和薪酬相關欄位',
      columns: {
        service_date: true,
        customer_name: true,
        service_address: true,
        start_time: true,
        end_time: true,
        service_hours: true,
        care_staff_name: false,  // 工資模式不預設勾選，因為大標題會顯示
        staff_id: true,
        service_type: true,
        staff_salary: true,     // 工資模式自動包含
        service_profit: false,  // 工資模式不包含服務利潤
        hourly_salary: true,    // 工資模式自動包含
        customer_id: false,
        phone: false,
        service_fee: false,
        hourly_rate: false,
        project_category: false,
        project_manager: false,
      }
    }
  }

  // 觸發資料刷新的函數
  const handleRefresh = () => {
    setRefreshTrigger(prev => prev + 1)
  }

  // 主要組件的編輯和刪除處理函數
  const handleEdit = (record: BillingSalaryRecord) => {
    console.log('🖊️ 主要組件 handleEdit - 點擊編輯按鈕，記錄:', record)
    setEditingRecord(record)
    setIsEditModalOpen(true)
  }

  const handleEditSave = async (formData: BillingSalaryFormData) => {
    if (!editingRecord) return

    try {
      setExportLoading(true)
      console.log('🔄 主要組件 handleEditSave 開始更新記錄:', {
        recordId: editingRecord.id,
        formData
      })

      const response = await updateBillingSalaryRecord(editingRecord.id, formData)

      console.log('📝 主要組件 handleEditSave 更新結果:', response)

      if (response.success) {
        // 🔔 設置更新時間到 localStorage (在任何其他操作之前)
        const updateTime = new Date()
        const updateTimeStr = updateTime.toISOString()
        
        console.log('🕐 設置記錄更新時間:', {
          recordId: editingRecord.id,
          updateTime: updateTimeStr
        })
        
        // 更新狀態
        setRecordUpdateTimes(prev => ({
          ...prev,
          [editingRecord.id]: updateTime
        }))
        
        // 持久化到 localStorage（30分鐘）
        localStorage.setItem(`service_update_${editingRecord.id}`, updateTimeStr)

        console.log('💾 localStorage 已設置:', `service_update_${editingRecord.id}`, updateTimeStr)
        
        // 觸發自定義事件
        window.dispatchEvent(new CustomEvent('recordUpdated', {
          detail: { recordId: editingRecord.id }
        }))
        
        console.log('📡 recordUpdated 事件已觸發:', editingRecord.id)
        
        setIsEditModalOpen(false)
        setEditingRecord(null)
        // 設置最後更新時間
        setLastUpdateTime(new Date())
        
        // 顯示成功提示 (延遲一點點，確保localStorage已設置)
        setTimeout(() => {
          console.log('✅ 記錄更新成功！')
        }, 100)
        
      } else {
        console.error('❌ 更新記錄失敗:', response.error || '未知錯誤')
      }
    } catch (error) {
      console.error('更新記錄失敗:', error)
      console.error('❌ 更新失敗:', error)
    } finally {
      setExportLoading(false)
    }
  }

  const handleEditCancel = () => {
    setIsEditModalOpen(false)
    setEditingRecord(null)
  }

  const handleDelete = async (recordId: string) => {
    if (!confirm('確定要刪除這筆記錄嗎？此操作無法撤銷。')) return

    try {
      setExportLoading(true)
      console.log('🗑️ 主要組件 handleDelete 開始刪除記錄:', recordId)

      const response = await deleteBillingSalaryRecord(recordId)

      console.log('🗑️ 主要組件 handleDelete 刪除結果:', response)

      if (response.success) {
        alert('記錄刪除成功！')
        // 觸發資料刷新
        handleRefresh()
        // 設置最後更新時間
        setLastUpdateTime(new Date())
        // 設置特定記錄的更新時間（刪除後會被清除，但先設置以防其他組件需要）
        setRecordUpdateTimes(prev => ({
          ...prev,
          [recordId]: new Date()
        }))
      } else {
        alert('刪除記錄失敗：' + (response.error || '未知錯誤'))
      }
    } catch (error) {
      console.error('刪除記錄失敗:', error)
      alert('刪除記錄失敗，請重試')
    } finally {
      setExportLoading(false)
    }
  }

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setUser(user)
      } else {
        router.push('/')
      }
      setLoading(false)
    }

    getUser()
  }, [router])

  // 載入 KPI 和分類數據
  useEffect(() => {
    if (user && activeTab === 'overview') {
      loadKPIData()
    }
  }, [user, filters.dateRange?.start, filters.dateRange?.end, activeTab])

  const loadKPIData = async () => {
    setKpiLoading(true)
    try {
      // 載入 KPI 數據
      const kpiResult = await getBusinessKPI({
        start: filters.dateRange?.start || '',
        end: filters.dateRange?.end || ''
      })
      if (kpiResult.success && kpiResult.data) {
        setKpiData(kpiResult.data)
      }

      // 載入分類統計
      const categoryResult = await getProjectCategorySummary({
        start: filters.dateRange?.start || '',
        end: filters.dateRange?.end || ''
      })
      if (categoryResult.success && categoryResult.data) {
        setCategorySummary(categoryResult.data)
      }
    } catch (error) {
      console.error('載入數據失敗:', error)
    } finally {
      setKpiLoading(false)
    }
  }

  // 載入護理員列表 (當需要顯示護理員下載頁面時)
  useEffect(() => {
    if (showStaffListPage) {
      const loadStaffList = async () => {
        setLoadingStaff(true)
        try {
          const response = await fetchAllBillingSalaryRecords(filters)
          if (response.success && response.data) {
            // 從當前數據中提取護理員列表（優先使用 staff_id）
            const staffMap = new Map<string, StaffOption>()

            response.data
              .filter((record: BillingSalaryRecord) => record.care_staff_name && record.care_staff_name.trim() !== '')
              .forEach((record: BillingSalaryRecord) => {
                const name = record.care_staff_name.trim()
                const rawId = record.staff_id?.trim() || null
                const normalizedId = normalizeStaffId(rawId)
                const normalizedName = normalizeStaffName(name)
                const key = normalizedId || normalizedName

                if (!key) return

                if (!staffMap.has(key)) {
                  staffMap.set(key, {
                    name,
                    staffId: rawId,
                    normalizedName,
                    normalizedId
                  })
                }
              })

            const sortedStaff = Array.from(staffMap.values()).sort((a, b) =>
              (a.normalizedName || '').localeCompare(b.normalizedName || '', 'zh-HK')
            )

            setStaffList(sortedStaff)
          }
        } catch (error) {
          console.error('載入護理員列表失敗:', error)
        } finally {
          setLoadingStaff(false)
        }
      }

      loadStaffList()
    }
  }, [showStaffListPage, filters])

  const updateDateRange = (preset: DateRangePreset) => {
    const now = new Date()
    let start: Date, end: Date

    switch (preset) {
      case 'last7days':
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        end = now
        break
      case 'last30days':
        start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        end = now
        break
      case 'last90days':
        start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        end = now
        break
      case 'thisMonth':
        // 確保使用本地時間，避免時區問題
        start = new Date(now.getFullYear(), now.getMonth(), 1)
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
        break
      case 'lastMonth':
        // 確保使用本地時間，避免時區問題
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        end = new Date(now.getFullYear(), now.getMonth(), 0)
        break
      case 'last3months':
        // 最近3個月
        start = new Date(now.getFullYear(), now.getMonth() - 2, 1)
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
        break
      case 'last6months':
        // 最近6個月
        start = new Date(now.getFullYear(), now.getMonth() - 5, 1)
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
        break
      case 'thisQuarter':
        // 本季度
        const quarterStart = Math.floor(now.getMonth() / 3) * 3
        start = new Date(now.getFullYear(), quarterStart, 1)
        end = new Date(now.getFullYear(), quarterStart + 3, 0)
        break
      case 'thisYear':
        // 本年度
        start = new Date(now.getFullYear(), 0, 1)
        end = new Date(now.getFullYear(), 12, 0)
        break
      default:
        return
    }

    // 使用统一的日期格式化函数
    setFilters(prev => ({
      ...prev,
      dateRange: {
        start: formatDateLocal(start),
        end: formatDateLocal(end)
      }
    }))
  }

  // 處理導出模式切換
  const handleExportModeChange = (mode: 'accounting' | 'payroll') => {
    setExportMode(mode)
    // 所有模式都自動配置預設欄位
    setExportColumns(exportModeConfigs[mode].columns)
  }

  // 導出功能 - 支持PDF和項目選擇
  const handleExport = () => {
    setShowExportModal(true)
  }

  // 日曆導出功能
  const handleCalendarExport = async () => {
    setCalendarExportLoading(true)
    try {
      console.log('🚀 開始導出日曆，格式:', 'pdf')
      
      const exportOptions: CalendarExportOptions = {
        format: 'pdf',
        filters,
        includeStaffDetails: true,
        includeCustomerDetails: false,
        timezone: 'Asia/Hong_Kong'
      }

      const result = await exportCalendar(exportOptions)
      
      if (result.success && result.data) {
        console.log('✅ 日曆 HTML 內容已生成')
        const htmlContent = result.data as string
        const viewer = window.open('', '_blank')

        if (viewer && viewer.document) {
          viewer.opener = null
          viewer.document.open()
          viewer.document.write(htmlContent)
          viewer.document.close()
        } else {
          console.warn('瀏覽器封鎖了彈出視窗，於目前頁面開啟日曆。')
          const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          window.location.href = url
          setTimeout(() => {
            URL.revokeObjectURL(url)
          }, 60_000)
        }
      } else {
        console.error('❌ 日曆導出失敗:', result.error)
        alert(`日曆導出失敗: ${result.error}`)
      }
    } catch (error) {
      console.error('❌ 日曆導出錯誤:', error)
      alert('日曆導出失敗，請稍後再試')
    } finally {
      setCalendarExportLoading(false)
    }
  }

  const handleExportConfirm = async () => {
    setExportLoading(true)
    setShowExportModal(false)

    try {
      // 獲取要導出的數據（分批獲取，無上限）
      const response = await fetchAllBillingSalaryRecords(filters)

      if (!response.success || !response.data) {
        throw new Error('無法獲取數據')
      }

      let records = response.data || []

      // 對數模式需要特殊排序：先按客戶名稱，再按日期
      if (exportMode === 'accounting') {
        records = records.sort((a, b) => {
          // 1. 先按客戶名稱排序
          const nameComparison = (a.customer_name || '').localeCompare(b.customer_name || '', 'zh-TW')
          if (nameComparison !== 0) {
            return nameComparison
          }

          // 2. 客戶名稱相同時，再按日期排序
          const dateA = new Date(a.service_date || '')
          const dateB = new Date(b.service_date || '')
          return dateA.getTime() - dateB.getTime()
        })
      }

      // 根據選擇的欄位過濾數據
      const selectedColumns = Object.entries(exportColumns)
        .filter(([_, selected]) => selected)
        .map(([column, _]) => column)

      if (exportFormat === 'pdf') {
        // 工資模式且選擇分開PDF的特殊處理
        if (exportMode === 'payroll' && payrollExportType === 'separate') {
          // 跳轉到護理員列表頁面
          setShowExportModal(false)
          setShowStaffListPage(true)
          setStaffDownloadStatus({}) // 重置下載狀態
        } else {
          await exportToPDF(records, selectedColumns)
        }
      } else {
        await exportToCSVCustom(records, selectedColumns)
      }

      alert('導出成功')
    } catch (error) {
      console.error('Export error:', error)
      alert('導出時發生錯誤')
    } finally {
      setExportLoading(false)
    }
  }

  const downloadSingleStaffPDF = async (staff: StaffOption, records: any[], columns: string[]) => {
    try {
      const staffKey = getStaffKey(staff)
      const staffDisplayName = getStaffDisplayName(staff)
      // 篩選該護理員的記錄
      const staffRecords = (records || []).filter((record: BillingSalaryRecord) =>
        doesRecordBelongToStaff(record, staff)
      )

      if (staffRecords.length === 0) {
        alert(`${staffDisplayName} 沒有符合條件的記錄`)
        return
      }

      // 按日期排序
      staffRecords.sort((a, b) => new Date(a.service_date).getTime() - new Date(b.service_date).getTime())

      await generateAndDownloadStaffPDF(staffRecords, columns, staff)

      // 更新下載狀態
      if (staffKey) {
        setStaffDownloadStatus(prev => ({
          ...prev,
          [staffKey]: 'downloaded'
        }))
      }

    } catch (error) {
      console.error('下載護理員PDF時發生錯誤:', error)
      alert('下載護理員PDF時發生錯誤')
    }
  }

  const generateAndDownloadStaffPDF = async (records: any[], columns: string[], staff: StaffOption) => {
    const staffName = staff.name
    const staffDisplayName = getStaffDisplayName(staff)
    // 查詢員工資料
    let staffData = null
    try {
      if (staff.staffId) {
        const { data, error } = await supabase
          .from('care_staff_profiles')
          .select('staff_id, name_chinese, name_english, hkid')
          .eq('staff_id', staff.staffId)
          .single()

        if (!error && data) {
          staffData = data
        }
      }

      if (!staffData) {
        const { data, error } = await supabase
          .from('care_staff_profiles')
          .select('staff_id, name_chinese, name_english, hkid')
          .eq('name_chinese', staffName)
          .single()

        if (!error && data) {
          staffData = data
        }
      }
    } catch (error) {
      console.error('查詢護理人員資料失敗:', error)
    }

    // 完整的欄位標籤映射
    const columnLabels: Record<string, string> = {
      service_date: '服務日期',
      customer_id: '客戶編號',
      customer_name: '客戶姓名',
      phone: '客戶電話',
      service_address: '服務地址',
      start_time: '開始時間',
      end_time: '結束時間',
      service_hours: '服務時數',
      care_staff_name: '護理員姓名',
      staff_id: '護理員編號',
      service_fee: '服務費用',
      staff_salary: '護理員工資',
      service_profit: '服務利潤',
      hourly_rate: '每小時收費',
      hourly_salary: '每小時工資',
      service_type: '服務類型',
      project_category: '所屬項目',
      project_manager: '項目經理',
      // 舊欄位名稱兼容（已停用）
      service_time: '服務時間',
      customer_address: '客戶地址',
      notes: '備註'
    }

    // 計算總結數據
    const totalRecords = records.length
    const totalHours = records.reduce((sum, record) => {
      const hours = parseFloat(String(record.service_hours || '0'))
      return Math.round((sum + (isNaN(hours) ? 0 : hours)) * 100) / 100
    }, 0)
    const totalSalary = records.reduce((sum, record) => {
      const salary = parseFloat(String(record.staff_salary || '0'))
      return Math.round((sum + (isNaN(salary) ? 0 : salary)) * 100) / 100
    }, 0)

    // 按所屬項目分組統計
    const projectStats = records.reduce((acc, record) => {
      const project = record.project_category || '未分類'
      if (!acc[project]) {
        acc[project] = {
          count: 0,
          hours: 0,
          salary: 0
        }
      }
      acc[project].count += 1
      acc[project].hours = Math.round((acc[project].hours + parseFloat(String(record.service_hours || '0'))) * 100) / 100
      acc[project].salary = Math.round((acc[project].salary + parseFloat(String(record.staff_salary || '0'))) * 100) / 100
      return acc
    }, {} as Record<string, { count: number; hours: number; salary: number }>)

    const today = new Date()
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    // 生成YYYY-MM格式（根據記錄的第一個日期）
    const firstRecord = records[0]
    const serviceDate = new Date(firstRecord?.service_date || today)
    const yearMonth = `${serviceDate.getFullYear()}-${String(serviceDate.getMonth() + 1).padStart(2, '0')}`

    const logoUrl = getAssetPath('images/mingcare-logo.png')
    const stampUrl = getAssetPath('images/company-stamp.png')

    // 創建HTML內容
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>${staffDisplayName} ${yearMonth}工資明細</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 15mm;
          }
          body {
            font-family: "PingFang TC", "Microsoft JhengHei", "SimHei", sans-serif;
            margin: 0;
            padding: 15px;
            font-size: max(11px, 0.8vw);
            line-height: 1.3;
            min-font-size: 9px;
          }
          @media print {
            body {
              font-size: 11px !important;
            }
            .responsive-text {
              font-size: max(9px, 10px) !important;
            }
            .keep-together {
              page-break-inside: avoid;
            }
            table {
              page-break-inside: auto;
            }
            tr {
              page-break-inside: avoid;
              page-break-after: auto;
            }
          }
          .header-container {
            margin-bottom: 20px;
            position: relative;
          }
          .company-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 15px;
          }
          .company-info {
            flex: 1;
            text-align: left;
          }
          .company-logo {
            flex: 0 0 180px;
            text-align: center;
          }
          .company-logo img {
            max-width: 180px;
            max-height: 180px;
          }
          .company-stamp {
            flex: 0 0 60px;
            text-align: center;
          }
          .company-stamp img {
            max-width: 60px;
            max-height: 60px;
          }
          .company-name {
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 5px;
          }
          .company-details {
            font-size: 11px;
            line-height: 1.4;
          }
          .staff-info {
            background-color: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 5px;
            padding: 8px;
            margin-bottom: 15px;
          }
          .staff-info-title {
            font-size: 12px;
            font-weight: bold;
            margin-bottom: 6px;
            color: #495057;
          }
          .staff-details {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
            font-size: 10px;
          }
          .staff-field {
            display: flex;
          }
          .staff-field strong {
            width: 70px;
            color: #495057;
          }
          .header {
            text-align: center;
            margin-bottom: 15px;
          }
          .title {
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 8px;
          }
          .subtitle {
            font-size: 12px;
            margin-bottom: 5px;
          }
          .summary {
            margin-bottom: 15px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
            font-size: max(10px, 0.7vw);
          }
          th, td {
            border: 1px solid #ddd;
            padding: 6px 4px;
            text-align: left;
            font-size: max(10px, 0.7vw);
            word-wrap: break-word;
          }
          @media print {
            table {
              font-size: 10px !important;
            }
            th, td {
              font-size: 10px !important;
              padding: 4px 3px;
            }
          }
          th {
            background-color: #f2f2f2;
            font-weight: bold;
          }
          tr:nth-child(even) {
            background-color: #f9f9f9;
          }
        </style>
      </head>
      <body>
        <div class="header-container">
          <!-- 公司信息與標誌 -->
          <div class="company-header">
            <div class="company-info">
              <div class="company-name">明家居家護理服護有限公司</div>
              <div class="company-details">
                地址：新界荃灣橫龍街43-47號龍力工業大廈3樓308室<br>
                電話：+852 2338 1811<br>
                電郵：info@mingcarehome.com<br>
                網址：www.mingcarehome.com
              </div>
            </div>
            <div class="company-logo">
              <img src="${logoUrl}" alt="明家居家護理標誌" onerror="this.style.display='none'">
            </div>
          </div>

          <!-- 護理人員資料 -->
          ${staffData ? `
          <div class="staff-info">
              <div class="staff-info-title">護理人員資料</div>
              <div class="staff-details">
                <div class="staff-field">
                  <strong>中文姓名:</strong>
                  <span>${staffData.name_chinese || staffName}</span>
                </div>
              <div class="staff-field">
                <strong>英文姓名:</strong>
                <span>${staffData.name_english || ''}</span>
              </div>
              <div class="staff-field">
                  <strong>員工編號:</strong>
                <span>${staffData.staff_id || staff.staffId || ''}</span>
              </div>
              <div class="staff-field">
                <strong>身份證號:</strong>
                <span>${staffData.hkid ? staffData.hkid.substring(0, Math.max(0, staffData.hkid.length - 4)) + 'xxxx' : ''}</span>
              </div>
            </div>
          </div>
          ` : ''}
        </div>

        <table>
          <thead>
            <tr>
              ${columns.map(col => `<th>${columnLabels[col] || col}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${records.map(record => `
              <tr>
                ${columns.map(col => {
                  let value = ''
                  switch (col) {
                    case 'service_date':
                      const date = new Date(record[col])
                      value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
                      break
                    case 'start_time':
                    case 'end_time':
                      // 如果時間格式是 HH:MM，直接顯示；如果是完整日期時間，提取時間部分
                      const timeValue = record[col] || ''
                      if (timeValue.includes('T') || timeValue.includes(' ')) {
                        const timeDate = new Date(timeValue)
                        value = `${String(timeDate.getHours()).padStart(2, '0')}:${String(timeDate.getMinutes()).padStart(2, '0')}`
                      } else {
                        value = timeValue
                      }
                      break
                    case 'service_hours':
                      const hours = parseFloat(String(record[col] || '0'))
                      value = isNaN(hours) ? '0' : hours.toString()
                      break
                    case 'staff_salary':
                    case 'service_fee':
                    case 'hourly_rate':
                    case 'hourly_salary':
                    case 'billing_amount':
                      const num = parseFloat(record[col] || '0')
                      value = isNaN(num) ? '$0.00' : `$${num.toFixed(2)}`
                      break
                    case 'service_profit':
                      // 優先使用 profit 欄位（從 API 返回的計算結果）
                      let profitValue: number
                      if (record.profit !== undefined && record.profit !== null) {
                        profitValue = typeof record.profit === 'number' ? record.profit : parseFloat(String(record.profit))
                      } else {
                        // 備用計算方式
                        const serviceFee = parseFloat(record.service_fee || '0')
                        const staffSalary = parseFloat(record.staff_salary || '0')
                        profitValue = serviceFee - staffSalary
                      }
                      value = `$${profitValue.toFixed(2)}`
                      break
                    default:
                      value = String(record[col] || '')
                  }
                  return `<td>${value}</td>`
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>

        <!-- 底部佈局：左邊統計，右邊印章 -->
        <div style="margin-top: 20px; display: flex; justify-content: space-between; align-items: flex-end;">
          <!-- 左邊：總計統計資訊 -->
          <div style="flex: 1;">
            <div style="margin-bottom: 5px; font-size: 12px;"><strong>總服務次數:</strong> ${totalRecords} 次</div>
            <div style="margin-bottom: 5px; font-size: 12px;"><strong>總時數:</strong> ${totalHours.toFixed(1)} 小時</div>
            <div style="font-weight: bold; font-size: 14px; color: #000000;"><strong>總工資:</strong> $${totalSalary.toFixed(2)}</div>
          </div>
          <!-- 右邊：公司印章 -->
          <div style="flex: 0 0 auto;">
            <img src="${stampUrl}" alt="公司印章" style="width: 80px; height: auto;" onerror="this.style.display='none'">
          </div>
        </div>
      </body>
      </html>
    `

    // 在新視窗中開啟並列印
    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.write(htmlContent)
      printWindow.document.close()

      printWindow.addEventListener('load', () => {
        setTimeout(() => {
          printWindow.print()
          printWindow.close()
        }, 500)
      })
    }
  }

  const generateAndDownloadSummaryPDF = async (summaryData: { staffName: string; totalAmount: number; recordCount: number }[]) => {
    const grandTotal = summaryData.reduce((sum, item) => sum + item.totalAmount, 0)
    const totalRecords = summaryData.reduce((sum, item) => sum + item.recordCount, 0)

    const today = new Date()
    const dateStr = `${today.getFullYear()}年${String(today.getMonth() + 1).padStart(2, '0')}月${String(today.getDate()).padStart(2, '0')}日`

    const logoUrl = getAssetPath('images/mingcare-logo.png')
    const stampUrl = getAssetPath('images/company-stamp.png')

    // 創建HTML內容
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>工資總結報表</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 15mm;
          }
          body {
            font-family: "PingFang TC", "Microsoft JhengHei", "SimHei", sans-serif;
            margin: 0;
            padding: 15px;
            font-size: max(11px, 0.8vw);
            line-height: 1.3;
            min-font-size: 9px;
          }
          @media print {
            body {
              font-size: 11px !important;
            }
            .keep-together {
              page-break-inside: avoid;
            }
            table {
              page-break-inside: auto;
            }
            tr {
              page-break-inside: avoid;
              page-break-after: auto;
            }
          }
          .header-container {
            margin-bottom: 20px;
            position: relative;
          }
          .company-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 15px;
          }
          .company-info {
            flex: 1;
            text-align: left;
          }
          .company-logo {
            flex: 0 0 180px;
            text-align: center;
          }
          .company-logo img {
            max-width: 180px;
            max-height: 180px;
          }
          .company-name {
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 5px;
          }
          .company-details {
            font-size: 11px;
            line-height: 1.4;
          }
          .header {
            text-align: center;
            margin-bottom: 20px;
          }
          .title {
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 8px;
          }
          .subtitle {
            font-size: 12px;
            margin-bottom: 5px;
          }
          .summary {
            margin-bottom: 15px;
          }
          .section-title {
            font-size: 14px;
            font-weight: bold;
            margin: 15px 0 8px 0;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
          }
          th, td {
            border: 1px solid #ddd;
            padding: 6px;
            text-align: left;
            font-size: max(11px, 0.8vw);
          }
          @media print {
            th, td {
              font-size: 11px !important;
            }
          }
          th {
            background-color: #f2f2f2;
            font-weight: bold;
          }
          .total-row {
            background-color: #e6f3ff;
            font-weight: bold;
          }
          tr:nth-child(even) {
            background-color: #f9f9f9;
          }
          .footer-container {
            margin-top: 25px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
          }
          .company-stamp {
            flex: 0 0 60px;
            text-align: left;
          }
          .company-stamp img {
            max-width: 60px;
            max-height: 60px;
          }
          .footer-company-info {
            flex: 1;
            text-align: right;
            font-size: 10px;
            line-height: 1.3;
          }
        </style>
      </head>
      <body>
        <div class="header-container">
          <!-- 公司信息與標誌 -->
          <div class="company-header">
            <div class="company-info">
              <div class="company-name">明家居家護理服護有限公司</div>
              <div class="company-details">
                地址：新界荃灣橫龍街43-47號龍力工業大廈3樓308室<br>
                電話：+852 2338 1811<br>
                電郵：info@mingcarehome.com<br>
                網址：www.mingcarehome.com
              </div>
            </div>
            <div class="company-logo">
              <img src="${logoUrl}" alt="明家居家護理標誌" onerror="this.style.display='none'">
            </div>
          </div>
        </div>

        <div class="summary">
          <div>總護理人員數: ${summaryData.length}人</div>
          <div>總記錄數: ${totalRecords}筆</div>
          <div>總金額: $${grandTotal.toFixed(2)}</div>
        </div>

        <div class="section-title">各護理人員明細:</div>

        <table>
          <thead>
            <tr>
              <th>護理人員</th>
              <th>記錄數</th>
              <th>總金額</th>
            </tr>
          </thead>
          <tbody>
            ${summaryData.map((item: any) => `
              <tr>
                <td>${item.staffName}</td>
                <td>${item.recordCount}</td>
                <td>$${item.totalAmount.toFixed(2)}</td>
              </tr>
            `).join('')}
            <tr class="total-row">
              <td>總計</td>
              <td>${totalRecords}</td>
              <td>$${grandTotal.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        <!-- 底部佈局：左邊統計，右邊印章 -->
        <div style="margin-top: 30px; display: flex; justify-content: space-between; align-items: flex-end;">
          <!-- 左邊：統計資訊 -->
          <div style="flex: 1;">
            <div style="margin-bottom: 5px; font-size: 12px;"><strong>總護理人員數:</strong> ${summaryData.length}人</div>
            <div style="margin-bottom: 5px; font-size: 12px;"><strong>總記錄數:</strong> ${totalRecords}筆</div>
            <div style="font-weight: bold; font-size: 14px; color: #000000;"><strong>總金額:</strong> $${grandTotal.toFixed(2)}</div>
          </div>
          <!-- 右邊：公司印章 -->
          <div style="flex: 0 0 auto;">
            <img src="${stampUrl}" alt="公司印章" style="width: 80px; height: auto;" onerror="this.style.display='none'">
          </div>
        </div>
      </body>
      </html>
    `

    // 在新視窗中開啟並列印
    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.write(htmlContent)
      printWindow.document.close()

      printWindow.addEventListener('load', () => {
        setTimeout(() => {
          printWindow.print()
          printWindow.close()
        }, 500)
      })
    }
  }

  const exportToPDF = async (records: any[], columns: string[]) => {
    try {
      // 欄位標籤映射 - 使用中文標題
      const columnLabels: Record<string, string> = {
        service_date: '服務日期',
        customer_id: '客戶編號',
        customer_name: '客戶姓名',
        phone: '客戶電話',
        service_address: '服務地址',
        start_time: '開始時間',
        end_time: '結束時間',
        service_hours: '服務時數',
        care_staff_name: '護理員姓名',
        service_fee: '服務費用',
        staff_salary: '護理員工資',
        service_profit: '服務利潤',
        staff_id: '護理員編號',
        hourly_rate: '每小時收費',
        hourly_salary: '每小時工資',
        service_type: '服務類型',
        project_category: '所屬項目',
        project_manager: '項目經理'
      }
      
      // 獲取欄位值的輔助函數（處理特殊欄位如服務利潤）
      const getColumnValue = (record: any, col: string): string => {
        if (col === 'service_profit') {
          // 優先使用 profit 欄位（從 API 返回的計算結果）
          let profitValue: number
          if (record.profit !== undefined && record.profit !== null) {
            profitValue = typeof record.profit === 'number' ? record.profit : parseFloat(String(record.profit))
          } else {
            // 備用計算方式
            const serviceFee = parseFloat(String(record.service_fee || '0'))
            const staffSalary = parseFloat(String(record.staff_salary || '0'))
            profitValue = serviceFee - staffSalary
          }
          return isNaN(profitValue) ? '$0.00' : `$${profitValue.toFixed(2)}`
        }
        
        // 處理數字類型欄位格式化
        const isMoneyField = ['service_fee', 'staff_salary', 'hourly_rate', 'hourly_salary'].includes(col)
        const value = record[col]
        
        if (isMoneyField) {
          const numValue = typeof value === 'number' ? value : parseFloat(String(value || '0'))
          return isNaN(numValue) ? '$0.00' : `$${numValue.toFixed(2)}`
        }
        
        // 處理服務時數
        if (col === 'service_hours') {
          const numValue = typeof value === 'number' ? value : parseFloat(String(value || '0'))
          return isNaN(numValue) ? '0' : numValue.toFixed(1)
        }
        
        return String(value || '')
      }

      // 檢查是否為對數模式
      const isAccountingMode = exportMode === 'accounting'

      // 獲取客戶的 CCSV 號碼（voucher_number）和身份證號碼（hkid）的映射
      const customerIds = [...new Set(records.map(r => r.customer_id).filter(Boolean))]
      const customerVoucherMap: Record<string, string> = {}
      const customerHkidMap: Record<string, string> = {}
      const customerIdByName: Record<string, string> = {}
      if (customerIds.length > 0) {
        try {
          // 分批查詢
          for (let i = 0; i < customerIds.length; i += 100) {
            const batch = customerIds.slice(i, i + 100)
            const { data: customerData } = await supabase
              .from('customer_personal_data')
              .select('customer_id, customer_name, voucher_number, hkid')
              .in('customer_id', batch)
            if (customerData) {
              customerData.forEach((c: any) => {
                if (c.voucher_number) {
                  customerVoucherMap[c.customer_id] = c.voucher_number
                }
                if (c.hkid) {
                  customerHkidMap[c.customer_id] = c.hkid
                }
                if (c.customer_name && c.customer_id) {
                  customerIdByName[c.customer_name] = c.customer_id
                }
              })
            }
          }
        } catch (err) {
          console.error('獲取客戶資料失敗:', err)
        }
      }
      // 也從 records 本身建立 customer_name → customer_id 映射
      records.forEach(r => {
        if (r.customer_name && r.customer_id && !customerIdByName[r.customer_name]) {
          customerIdByName[r.customer_name] = r.customer_id
        }
      })

      let tableContent = ''
      let summaryContent = ''

      if (isAccountingMode) {
        // 對數模式：按客戶分組並為每個客戶創建獨立表格
        const customerGroups: Record<string, any[]> = {}
        ;(records || []).forEach(record => {
          const customerName = record.customer_name || '未知客戶'
          if (!customerGroups[customerName]) {
            customerGroups[customerName] = []
          }
          customerGroups[customerName].push(record)
        })

        // 大結統計
        let totalCustomers = Object.keys(customerGroups).length
        let totalServices = records.length
        let totalHours = 0
        let totalFees = 0
        let totalSalary = 0
        let totalProfit = 0

        // 為每個客戶生成獨立的表格
        const customerTables = Object.keys(customerGroups).map((customerName, index) => {
          const customerRecords = customerGroups[customerName]

          // 客戶小結計算
          let customerHours = 0
          let customerFees = 0
          let customerSalaryTotal = 0
          let customerProfitTotal = 0

          // 生成客戶記錄
          const customerRows = customerRecords.map(record => {
            // 累計小結數據 - 使用 Math.round 修復浮點數精度問題
            customerHours = Math.round((customerHours + parseFloat(record.service_hours || '0')) * 100) / 100
            customerFees = Math.round((customerFees + parseFloat(record.service_fee || '0')) * 100) / 100
            customerSalaryTotal = Math.round((customerSalaryTotal + parseFloat(String(record.staff_salary || '0'))) * 100) / 100
            customerProfitTotal = Math.round((customerProfitTotal + (record.profit !== undefined ? record.profit : ((record.service_fee || 0) - (record.staff_salary || 0)))) * 100) / 100

            return `
              <tr>
                ${columns.map(col => {
                  const value = getColumnValue(record, col)
                  const isNumber = ['hourly_rate', 'hourly_salary', 'service_hours', 'service_fee', 'staff_salary', 'service_profit'].includes(col)
                  return `<td class="${isNumber ? 'number' : ''}">${value}</td>`
                }).join('')}
              </tr>
            `
          }).join('')

          // 動態生成客戶小結行 - 根據所選欄位顯示對應的合計
          const subtotalCells = columns.map((col, index) => {
            const isLast = index === columns.length - 1
            const cellStyle = 'text-align: right; font-weight: bold; background-color: #f0f8ff; border-top: 2px solid #428bca;'
            
            // 第一個欄位顯示小結標籤
            if (index === 0) {
              return `<td colspan="1" style="${cellStyle} text-align: left;">${customerName} 小結</td>`
            }
            
            // 根據欄位類型顯示合計
            switch (col) {
              case 'service_hours':
                return `<td style="${cellStyle}">${customerHours.toFixed(1)}</td>`
              case 'service_fee':
                return `<td style="${cellStyle}">$${customerFees.toFixed(2)}</td>`
              case 'staff_salary':
                return `<td style="${cellStyle}">$${customerSalaryTotal.toFixed(2)}</td>`
              case 'service_profit':
                return `<td style="${cellStyle}">$${customerProfitTotal.toFixed(2)}</td>`
              default:
                // 其他欄位留空
                return `<td style="${cellStyle}"></td>`
            }
          }).join('')
          
          const subtotalRow = `<tr class="customer-subtotal">${subtotalCells}</tr>`

          // 累計大結數據
          totalHours = Math.round((totalHours + customerHours) * 100) / 100
          totalFees = Math.round((totalFees + customerFees) * 100) / 100
          totalSalary = Math.round((totalSalary + customerSalaryTotal) * 100) / 100
          totalProfit = Math.round((totalProfit + customerProfitTotal) * 100) / 100

          // 生成客戶獨立表格
          // 獲取該客戶的身份證號碼和 CCSV
          const custId = customerIdByName[customerName] || customerRecords[0]?.customer_id || ''
          const custHkid = custId ? (customerHkidMap[custId] || '') : ''
          const custCCSV = custId ? (customerVoucherMap[custId] || '') : ''
          const custInfoParts: string[] = []
          if (custHkid) custInfoParts.push(`身份證: ${custHkid}`)
          if (custCCSV) custInfoParts.push(`CCSV: ${custCCSV}`)
          const custInfoStr = custInfoParts.length > 0 ? ` <span style="font-size: 13px; color: #666; font-weight: normal;">(${custInfoParts.join(' | ')})</span>` : ''

          return `
            <div class="customer-group">
              <h3 style="color: #428bca; margin: 20px 0 10px 0; font-size: 16px; border-bottom: 1px solid #428bca; padding-bottom: 5px;">
                ${customerName}${custInfoStr} (${customerRecords.length} 次服務)
              </h3>
              <table>
                <thead>
                  <tr>
                    ${columns.map(col => `<th>${columnLabels[col] || col}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${customerRows}
                  ${subtotalRow}
                </tbody>
              </table>
            </div>
          `
        }).join('')

        tableContent = customerTables

        // 計算服務類型統計
        const serviceTypeStats: Record<string, {
          count: number
          hours: number
          amount: number
          salary: number
          profit: number
        }> = {}

        // 計算項目統計
        const projectStats: Record<string, {
          count: number
          hours: number
          amount: number
          salary: number
          profit: number
        }> = {}

        records.forEach(record => {
          const serviceType = record.service_type || '未知服務類型'
          const project = record.project_category || '未分類'
          const hours = parseFloat(record.service_hours || '0')
          const amount = parseFloat(record.service_fee || '0')
          const salary = parseFloat(String(record.staff_salary || '0'))
          const profit = record.profit !== undefined ? record.profit : (amount - salary)

          if (!serviceTypeStats[serviceType]) {
            serviceTypeStats[serviceType] = { count: 0, hours: 0, amount: 0, salary: 0, profit: 0 }
          }

          if (!projectStats[project]) {
            projectStats[project] = { count: 0, hours: 0, amount: 0, salary: 0, profit: 0 }
          }

          serviceTypeStats[serviceType].count += 1
          serviceTypeStats[serviceType].hours += hours
          serviceTypeStats[serviceType].amount += amount
          serviceTypeStats[serviceType].salary += salary
          serviceTypeStats[serviceType].profit += profit

          projectStats[project].count += 1
          projectStats[project].hours += hours
          projectStats[project].amount += amount
          projectStats[project].salary += salary
          projectStats[project].profit += profit
        })

        // 動態生成總覽統計項目 - 根據選擇的欄位
        const summaryItems: string[] = []
        summaryItems.push(`
          <div style="text-align: center;">
            <div style="font-weight: bold; color: #428bca;">客戶總數</div>
            <div style="font-size: 18px; font-weight: bold;">${totalCustomers}</div>
          </div>
        `)
        summaryItems.push(`
          <div style="text-align: center;">
            <div style="font-weight: bold; color: #428bca;">服務次數</div>
            <div style="font-size: 18px; font-weight: bold;">${totalServices}</div>
          </div>
        `)
        if (columns.includes('service_hours')) {
          summaryItems.push(`
            <div style="text-align: center;">
              <div style="font-weight: bold; color: #428bca;">總服務時數</div>
              <div style="font-size: 18px; font-weight: bold;">${totalHours.toFixed(1)}</div>
            </div>
          `)
        }
        if (columns.includes('service_fee')) {
          summaryItems.push(`
            <div style="text-align: center;">
              <div style="font-weight: bold; color: #428bca;">總服務費用</div>
              <div style="font-size: 18px; font-weight: bold;">$${totalFees.toFixed(2)}</div>
            </div>
          `)
        }
        if (columns.includes('staff_salary')) {
          summaryItems.push(`
            <div style="text-align: center;">
              <div style="font-weight: bold; color: #428bca;">總人工</div>
              <div style="font-size: 18px; font-weight: bold;">$${totalSalary.toFixed(2)}</div>
            </div>
          `)
        }
        if (columns.includes('service_profit')) {
          summaryItems.push(`
            <div style="text-align: center;">
              <div style="font-weight: bold; color: #428bca;">總利潤</div>
              <div style="font-size: 18px; font-weight: bold;">$${totalProfit.toFixed(2)}</div>
            </div>
          `)
        }

        // 動態生成項目統計表格的欄位
        const projectTableHeaders: string[] = ['<th style="padding: 8px; border: 1px solid #ddd; text-align: left;">所屬項目</th>']
        const hasProjectCount = true  // 總是顯示次數
        projectTableHeaders.push('<th style="padding: 8px; border: 1px solid #ddd; text-align: center;">次數</th>')
        if (columns.includes('service_hours')) {
          projectTableHeaders.push('<th style="padding: 8px; border: 1px solid #ddd; text-align: center;">時數</th>')
        }
        if (columns.includes('service_fee')) {
          projectTableHeaders.push('<th style="padding: 8px; border: 1px solid #ddd; text-align: center;">金額</th>')
        }
        if (columns.includes('staff_salary')) {
          projectTableHeaders.push('<th style="padding: 8px; border: 1px solid #ddd; text-align: center;">人工</th>')
        }
        if (columns.includes('service_profit')) {
          projectTableHeaders.push('<th style="padding: 8px; border: 1px solid #ddd; text-align: center;">利潤</th>')
        }

        // 動態生成項目統計表格的數據行
        const projectTableRows = Object.entries(projectStats).sort(([a], [b]) => a.localeCompare(b, 'zh-TW')).map(([project, stats]) => {
          const cells: string[] = [`<td style="padding: 8px; border: 1px solid #ddd;">${project}</td>`]
          cells.push(`<td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${stats.count}</td>`)
          if (columns.includes('service_hours')) {
            cells.push(`<td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${stats.hours.toFixed(1)}</td>`)
          }
          if (columns.includes('service_fee')) {
            cells.push(`<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${stats.amount.toFixed(2)}</td>`)
          }
          if (columns.includes('staff_salary')) {
            cells.push(`<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${stats.salary.toFixed(2)}</td>`)
          }
          if (columns.includes('service_profit')) {
            cells.push(`<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${stats.profit.toFixed(2)}</td>`)
          }
          return `<tr>${cells.join('')}</tr>`
        }).join('')

        // 項目統計總計行
        const projectTotalCells: string[] = [`<td style="padding: 8px; border: 1px solid #ddd;">總計</td>`]
        projectTotalCells.push(`<td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${totalServices}</td>`)
        if (columns.includes('service_hours')) {
          projectTotalCells.push(`<td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${totalHours.toFixed(1)}</td>`)
        }
        if (columns.includes('service_fee')) {
          projectTotalCells.push(`<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${totalFees.toFixed(2)}</td>`)
        }
        if (columns.includes('staff_salary')) {
          projectTotalCells.push(`<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${totalSalary.toFixed(2)}</td>`)
        }
        if (columns.includes('service_profit')) {
          projectTotalCells.push(`<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${totalProfit.toFixed(2)}</td>`)
        }

        // 動態生成服務類型統計表格
        const serviceTypeTableRows = Object.keys(serviceTypeStats)
          .sort()
          .map(serviceType => {
            const stats = serviceTypeStats[serviceType]
            const cells: string[] = [`<td style="padding: 8px; border: 1px solid #ddd;">${serviceType}</td>`]
            cells.push(`<td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${stats.count}</td>`)
            if (columns.includes('service_hours')) {
              cells.push(`<td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${stats.hours.toFixed(1)}</td>`)
            }
            if (columns.includes('service_fee')) {
              cells.push(`<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${stats.amount.toFixed(2)}</td>`)
            }
            if (columns.includes('staff_salary')) {
              cells.push(`<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${stats.salary.toFixed(2)}</td>`)
            }
            if (columns.includes('service_profit')) {
              cells.push(`<td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${stats.profit.toFixed(2)}</td>`)
            }
            return `<tr>${cells.join('')}</tr>`
          }).join('')

        // 大結內容
        summaryContent = `
          <div style="margin-top: 30px; padding: 20px; border: 2px solid #428bca; background-color: #f8f9fa; page-break-inside: avoid;">
            <h3 style="text-align: center; color: #428bca; margin-bottom: 15px;">總結報告</h3>

            <!-- 總覽統計 -->
            <div style="display: flex; justify-content: space-around; font-size: 14px; margin-bottom: 20px;">
              ${summaryItems.join('')}
            </div>

            <!-- 項目統計 -->
            <div style="margin-top: 20px;">
              <h4 style="color: #428bca; margin-bottom: 10px; text-align: center;">各項目小結</h4>
              <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                <thead>
                  <tr style="background-color: #428bca; color: white;">
                    ${projectTableHeaders.join('')}
                  </tr>
                </thead>
                <tbody>
                  ${projectTableRows}
                  <tr style="background-color: #e7f3ff; font-weight: bold; border-top: 2px solid #428bca;">
                    ${projectTotalCells.join('')}
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- 服務類型細分統計 -->
            <div style="margin-top: 20px;">
              <h4 style="color: #428bca; margin-bottom: 10px; text-align: center;">服務類型統計明細</h4>
              <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                <thead>
                  <tr style="background-color: #428bca; color: white;">
                    ${projectTableHeaders.join('')}
                  </tr>
                </thead>
                <tbody>
                  ${serviceTypeTableRows}
                  <tr style="background-color: #e7f3ff; font-weight: bold; border-top: 2px solid #428bca;">
                    ${projectTotalCells.join('')}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        `

      } else if (exportMode === 'payroll') {
        // 工資模式：按護理人員分組，每人一頁
        const staffGroups: Record<string, BillingSalaryRecord[]> = {}
        const staffMeta: Record<string, { name: string; staffId?: string }> = {}

        ;(records || []).forEach(record => {
          const name = (record.care_staff_name || '未知護理人員').trim()
          if (!name) return
          const id = record.staff_id?.trim()
          const key = id || name

          if (!staffGroups[key]) {
            staffGroups[key] = []
            staffMeta[key] = { name, staffId: id || undefined }
          }

          staffGroups[key].push(record)
        })

        // 為每個護理人員排序（先按護理人員名稱，再按日期）
        const sortedStaffKeys = Object.keys(staffGroups).sort((a, b) =>
          (staffMeta[a]?.name || a).localeCompare(staffMeta[b]?.name || b, 'zh-HK')
        )

        // 總統計
        let totalStaff = sortedStaffKeys.length
        let totalServices = records.length
        let totalHours = 0
        let totalSalary = 0

        // 為每個護理人員生成獨立的表格
        const staffTables = sortedStaffKeys.map(staffKey => {
          const staffRecords = staffGroups[staffKey]
          const staffName = staffMeta[staffKey]?.name || '未知護理人員'
          const staffId = staffMeta[staffKey]?.staffId
          const staffDisplayName = staffId ? `${staffName}（${staffId}）` : staffName

          // 按日期排序
          staffRecords.sort((a, b) => new Date(a.service_date).getTime() - new Date(b.service_date).getTime())

          // 計算該護理人員的統計
          let staffHours = 0
          let staffSalary = 0

          staffRecords.forEach(record => {
            const hours = parseFloat(String(record.service_hours || '0'))
            const salary = parseFloat(String(record.staff_salary || '0'))
            staffHours = Math.round((staffHours + (isNaN(hours) ? 0 : hours)) * 100) / 100
            staffSalary = Math.round((staffSalary + (isNaN(salary) ? 0 : salary)) * 100) / 100
          })

          totalHours = Math.round((totalHours + staffHours) * 100) / 100
          totalSalary = Math.round((totalSalary + staffSalary) * 100) / 100

          // 追蹤已出現的客戶，用於顯示客戶ID/CCSV小標題
          const seenCustomers = new Set<string>()

          return `
            <div class="staff-group">
              <div class="staff-header">
                <h2>${staffDisplayName}</h2>
                <div class="staff-info">記錄數: ${staffRecords.length}筆</div>
              </div>

              <table class="data-table">
                <thead>
                  <tr>
                    ${columns.map(col => `<th>${columnLabels[col] || col}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${staffRecords.map(record => {
                    const custName = record.customer_name || '未知客戶'
                    const custKey = record.customer_id || custName
                    let customerHeaderRow = ''
                    if (!seenCustomers.has(custKey)) {
                      seenCustomers.add(custKey)
                      const cId = record.customer_id || customerIdByName[custName] || ''
                      const hkid = cId ? (customerHkidMap[cId] || '') : ''
                      const ccsv = cId ? (customerVoucherMap[cId] || '') : ''
                      const infoParts: string[] = []
                      if (hkid) infoParts.push(`身份證: ${hkid}`)
                      if (ccsv) infoParts.push(`CCSV: ${ccsv}`)
                      if (infoParts.length > 0) {
                        customerHeaderRow = `<tr style="background-color: #f0f7ff; border-top: 1px solid #428bca;">
                          <td colspan="${columns.length}" style="padding: 4px 8px; font-size: 11px; color: #2c5aa0; font-weight: 600;">
                            📋 ${custName} — ${infoParts.join(' | ')}
                          </td>
                        </tr>`
                      }
                    }
                    return `${customerHeaderRow}
                    <tr>
                      ${columns.map(col => {
                        const value = (record as any)[col] || ''
                        const isNumber = ['hourly_rate', 'hourly_salary', 'service_hours', 'service_fee', 'staff_salary', 'service_profit'].includes(col)
                        let displayValue = String(value)

                        // 特殊格式化
                        if (col === 'service_date' && value) {
                          const date = new Date(value)
                          const year = date.getFullYear()
                          const month = String(date.getMonth() + 1).padStart(2, '0')
                          const day = String(date.getDate()).padStart(2, '0')
                          displayValue = `${year}-${month}-${day}`
                        } else if (col === 'service_profit') {
                          // 優先使用 profit 欄位（從 API 返回的計算結果）
                          if (record.profit !== undefined && record.profit !== null) {
                            const profitValue = typeof record.profit === 'number' ? record.profit : parseFloat(String(record.profit))
                            displayValue = profitValue.toFixed(2)
                          } else {
                            // 備用計算方式
                            const serviceFee = parseFloat(String(record.service_fee || '0'))
                            const staffSalaryValue = parseFloat(String(record.staff_salary || '0'))
                            const profitCalc = serviceFee - staffSalaryValue
                            displayValue = profitCalc.toFixed(2)
                          }
                        } else if (isNumber && value) {
                          const num = parseFloat(String(value))
                          displayValue = isNaN(num) ? '0' : num.toFixed(2)
                        }

                        return `<td class="${isNumber ? 'number' : ''}">${displayValue}</td>`
                      }).join('')}
                    </tr>
                  `}).join('')}
                </tbody>
              </table>

              <div class="staff-summary">
                <div class="summary-row">
                  <div class="summary-item">
                    <span class="label">服務時數:</span>
                    <span class="value">${staffHours.toFixed(1)} 小時</span>
                  </div>
                  <div class="summary-item">
                    <span class="label">護理員工資:</span>
                    <span class="value">$${staffSalary.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
          `
        }).join('')

        tableContent = staffTables

        // 計算項目統計
        const projectStats: Record<string, { count: number; hours: number; salary: number }> = {}
        records.forEach(record => {
          const project = record.project_category || '未分類'
          if (!projectStats[project]) {
            projectStats[project] = { count: 0, hours: 0, salary: 0 }
          }
          projectStats[project].count += 1
          projectStats[project].hours = Math.round((projectStats[project].hours + parseFloat(String(record.service_hours || '0'))) * 100) / 100
          projectStats[project].salary = Math.round((projectStats[project].salary + parseFloat(String(record.staff_salary || '0'))) * 100) / 100
        })

        // 總結頁面
        summaryContent = `
          <div class="total-summary-page">
            <div class="summary-header">
              <h2>工資總結</h2>
            </div>
            <div class="summary-stats">
              <div class="stat-row">
                <div class="stat-item">
                  <div class="stat-label">護理員數量</div>
                  <div class="stat-value">${totalStaff} 人</div>
                </div>
                <div class="stat-item">
                  <div class="stat-label">總服務時數</div>
                  <div class="stat-value">${totalHours.toFixed(1)} 小時</div>
                </div>
                <div class="stat-item">
                  <div class="stat-label">總工資</div>
                  <div class="stat-value">$${totalSalary.toFixed(2)}</div>
                </div>
              </div>
            </div>

            <div class="staff-summary-table" style="margin-top: 30px;">
              <h3>各護理人員明細</h3>
              <table class="summary-table">
                <thead>
                  <tr>
                    <th>護理人員</th>
                    <th>服務次數</th>
                    <th>服務時數</th>
                    <th>工資</th>
                  </tr>
                </thead>
                <tbody>
                  ${sortedStaffKeys.map(staffKey => {
                    const staffRecords = staffGroups[staffKey]
                    const staffName = staffMeta[staffKey]?.name || '未知護理人員'
                    const staffId = staffMeta[staffKey]?.staffId
                    const displayName = staffId ? `${staffName}（${staffId}）` : staffName
                    const staffHours = staffRecords.reduce((sum, record) => {
                      const hours = parseFloat(String(record.service_hours || '0'))
                      return sum + (isNaN(hours) ? 0 : hours)
                    }, 0)
                    const staffSalary = staffRecords.reduce((sum, record) => {
                      const salary = parseFloat(String(record.staff_salary || '0'))
                      return sum + (isNaN(salary) ? 0 : salary)
                    }, 0)

                    return `
                      <tr>
                        <td>${displayName}</td>
                        <td class="number">${staffRecords.length}</td>
                        <td class="number">${staffHours.toFixed(1)}</td>
                        <td class="number">$${staffSalary.toFixed(2)}</td>
                      </tr>
                    `
                  }).join('')}
                  <tr class="total-row">
                    <td><strong>總計</strong></td>
                    <td class="number"><strong>${totalServices}</strong></td>
                    <td class="number"><strong>${totalHours.toFixed(1)}</strong></td>
                    <td class="number"><strong>$${totalSalary.toFixed(2)}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        `

      } else {
        // 非對數模式：普通表格 - 追蹤客戶首次出現以顯示身份證/CCSV
        const seenCustomersNormal = new Set<string>()
        tableContent = records.map(record => {
          const custName = record.customer_name || '未知客戶'
          const custKey = record.customer_id || custName
          let customerHeaderRow = ''
          if (!seenCustomersNormal.has(custKey)) {
            seenCustomersNormal.add(custKey)
            const cId = record.customer_id || customerIdByName[custName] || ''
            const hkid = cId ? (customerHkidMap[cId] || '') : ''
            const ccsv = cId ? (customerVoucherMap[cId] || '') : ''
            const infoParts: string[] = []
            if (hkid) infoParts.push(`身份證: ${hkid}`)
            if (ccsv) infoParts.push(`CCSV: ${ccsv}`)
            if (infoParts.length > 0) {
              customerHeaderRow = `<tr style="background-color: #f0f7ff; border-top: 1px solid #428bca;">
                <td colspan="${columns.length}" style="padding: 4px 8px; font-size: 11px; color: #2c5aa0; font-weight: 600;">
                  📋 ${custName} — ${infoParts.join(' | ')}
                </td>
              </tr>`
            }
          }
          return `${customerHeaderRow}
          <tr>
            ${columns.map(col => {
              const value = getColumnValue(record, col)
              const isNumber = ['hourly_rate', 'hourly_salary', 'service_hours', 'service_fee', 'staff_salary', 'service_profit'].includes(col)

              return `<td class="${isNumber ? 'number' : ''}">${value}</td>`
            }).join('')}
          </tr>`
        }).join('')
      }

      const logoUrl = getAssetPath('images/mingcare-logo.png')
      const stampUrl = getAssetPath('images/company-stamp.png')

      // 創建可打印的HTML內容
      // 從日期範圍提取月份作為標題
      const pdfTitle = (() => {
        const startDate = filters.dateRange?.start
        if (startDate) {
          const [year, month] = startDate.split('-').map(Number)
          return `${year}年${month}月服務記錄 - 明家居家護理服務`
        }
        return '服務記錄 - 明家居家護理服務'
      })()

      const printContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>${pdfTitle}</title>
          <style>
            @media print {
              @page {
                size: A4 portrait;
                margin: 12mm;
              }
              body {
                margin: 0;
                font-size: 10px;
              }
              .customer-group {
                page-break-inside: avoid;
                page-break-after: auto;
              }
              .customer-group:last-child {
                page-break-after: auto;
              }
              .staff-group {
                page-break-inside: avoid;
                page-break-after: auto;
              }
              .staff-group:last-child {
                page-break-after: auto;
              }
              .total-summary-page {
                page-break-before: auto;
              }
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "微軟雅黑", Arial, sans-serif;
              font-size: max(10px, 0.7vw);
              line-height: 1.3;
              margin: 0;
              padding: 8px;
              min-font-size: 9px;
            }
            @media print {
              body {
                font-size: 10px !important;
              }
            }
            .header {
              text-align: center;
              margin-bottom: 15px;
              border-bottom: 2px solid #333;
              padding-bottom: 8px;
            }
            .header h1 {
              margin: 0;
              font-size: 16px;
              color: #333;
            }
            .header h2 {
              margin: 5px 0;
              font-size: 12px;
              color: #666;
            }
            .meta {
              text-align: center;
              margin: 8px 0;
              font-size: 9px;
              color: #888;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 8px 0;
              font-size: max(9px, 0.6vw);
            }
            th, td {
              border: 1px solid #ddd;
              padding: 3px 4px;
              text-align: left;
              word-wrap: break-word;
            }
            @media print {
              table {
                font-size: 9px !important;
              }
              th, td {
                font-size: 9px !important;
                padding: 2px 3px;
              }
            }
            th {
              background-color: #428bca;
              color: white;
              font-weight: bold;
              text-align: center;
              font-size: 10px;
            }
            tr:nth-child(even) {
              background-color: #f8f9fa;
            }
            .number {
              text-align: right;
            }
            .customer-subtotal {
              background-color: #f0f8ff !important;
            }
            .staff-group {
              margin-bottom: 30px;
            }
            .staff-header {
              background-color: #e8f4fd;
              padding: 15px;
              border-radius: 8px;
              margin-bottom: 15px;
              border-left: 4px solid #428bca;
            }
            .staff-header h2 {
              margin: 0;
              color: #2c5282;
              font-size: 18px;
            }
            .staff-info {
              color: #666;
              font-size: 14px;
              margin-top: 5px;
            }
            .staff-summary {
              background-color: #f8f9fa;
              padding: 15px;
              border-radius: 8px;
              margin-top: 15px;
              border: 1px solid #e0e0e0;
            }
            .summary-row {
              display: flex;
              justify-content: space-around;
              align-items: center;
            }
            .summary-item {
              text-align: center;
              flex: 1;
            }
            .summary-item .label {
              display: block;
              font-weight: bold;
              color: #666;
              font-size: 13px;
              margin-bottom: 5px;
            }
            .summary-item .value {
              display: block;
              font-size: 16px;
              font-weight: bold;
              color: #2c5282;
            }
            .total-summary-page {
              padding: 20px;
            }
            .summary-header {
              text-align: center;
              margin-bottom: 30px;
              border-bottom: 2px solid #428bca;
              padding-bottom: 15px;
            }
            .summary-header h2 {
              margin: 0;
              color: #2c5282;
              font-size: 24px;
            }
            .summary-stats {
              margin-bottom: 30px;
              background-color: #f8f9fa;
              padding: 20px;
              border-radius: 8px;
            }
            .stat-row {
              display: flex;
              justify-content: space-around;
              align-items: center;
            }
            .stat-item {
              text-align: center;
              flex: 1;
            }
            .stat-label {
              font-weight: bold;
              color: #666;
              font-size: 14px;
              margin-bottom: 8px;
            }
            .stat-value {
              font-size: 20px;
              font-weight: bold;
              color: #2c5282;
            }
            .staff-summary-table h3 {
              color: #2c5282;
              margin-bottom: 15px;
              font-size: 18px;
            }
            .summary-table {
              margin-top: 0;
            }
            .total-row {
              background-color: #e8f4fd !important;
              font-weight: bold;
            }
            .footer {
              margin-top: 15px;
              text-align: center;
              font-size: 10px;
              color: #666;
              border-top: 1px solid #ddd;
              padding-top: 10px;
            }
            @media screen {
              .print-button {
                position: fixed;
                top: 20px;
                right: 20px;
                background: #007bff;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
                font-size: 14px;
                z-index: 1000;
              }
              .print-button:hover {
                background: #0056b3;
              }
            }
            @media print {
              .print-button { display: none; }
            }
          </style>
        </head>
        <body>
          <button class="print-button" onclick="window.print()">列印 / 儲存為PDF</button>

          <div class="header">
            <!-- Company Info and Logo Row -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
              <!-- Left: Company Info -->
              <div style="flex: 1; font-size: 11px; line-height: 1.4; text-align: left;">
                <div style="font-weight: bold; color: #2c5aa0;">明家居家護理服護有限公司</div>
                <div>地址：新界荃灣橫龍街43-47號龍力工業大廈3樓308室</div>
                <div>電話：+852 2338 1811</div>
                <div>電郵：info@mingcarehome.com</div>
                <div>網址：www.mingcarehome.com</div>
              </div>

              <!-- Right: Company Logo -->
              <div style="flex: 0 0 auto; text-align: right;">
                <img src="${logoUrl}" alt="明家居家護理標誌" style="height: 80px; width: auto;">
              </div>
            </div>

            <h1>${pdfTitle}</h1>
            ${isAccountingMode ? '<div style="color: #428bca; font-weight: bold; margin-top: 5px;">對數模式</div>' : ''}
            ${exportMode === 'payroll' ? '<div style="color: #28a745; font-weight: bold; margin-top: 5px;">工資模式</div>' : ''}
          </div>

          <div class="meta">
            日期範圍: ${filters.dateRange?.start || '未設定'} ~ ${filters.dateRange?.end || '未設定'}<br>
            生成時間: ${new Date().toLocaleDateString('zh-TW')} ${new Date().toLocaleTimeString('zh-TW')}
          </div>

          ${isAccountingMode || exportMode === 'payroll' ? tableContent : `
          <table>
            <thead>
              <tr>
                ${columns.map(col => `<th>${columnLabels[col] || col}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${tableContent}
            </tbody>
          </table>
          `}

          ${summaryContent}

          <!-- 底部佈局：左邊統計，右邊印章 -->
          <div style="margin-top: 30px; display: flex; justify-content: space-between; align-items: flex-end;">
            <!-- 左邊：報表統計 -->
            <div style="flex: 1;">
              <div style="margin-bottom: 5px; font-size: 12px;"><strong>報表記錄數:</strong> ${records.length} 筆</div>
              <div style="margin-bottom: 5px; font-size: 12px;"><strong>欄位數:</strong> ${columns.length} 個</div>
            </div>
            <!-- 右邊：公司印章 -->
            <div style="flex: 0 0 auto;">
              <img src="${stampUrl}" alt="公司印章" style="height: 80px; width: auto;">
            </div>
          </div>
        </body>
        </html>
      `

      // 在新視窗中打開可打印的頁面
      const printWindow = window.open('', '_blank')
      if (printWindow) {
        printWindow.document.write(printContent)
        printWindow.document.close()

        // 等待內容載入後自動打印
        printWindow.onload = () => {
          setTimeout(() => {
            printWindow.focus()
            // 用戶可以選擇打印或儲存為PDF
          }, 500)
        }
      } else {
        // 如果無法開啟新視窗，回退到下載HTML文件
        const blob = new Blob([printContent], { type: 'text/html;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `mingcare_report_${filters.dateRange?.start || 'unknown'}_${filters.dateRange?.end || 'unknown'}.html`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)

        alert('已下載HTML文件，請在瀏覽器中打開後列印或儲存為PDF')
      }

    } catch (error) {
      console.error('PDF導出錯誤:', error)
      alert('PDF導出失敗，請稍後再試或選擇CSV格式')
      throw error
    }
  }

  const exportToCSVCustom = async (records: any[], columns: string[]) => {
    const columnLabels: Record<string, string> = {
      service_date: '服務日期',
      customer_id: '客戶編號',
      customer_name: '客戶姓名',
      phone: '客戶電話',
      service_address: '服務地址',
      start_time: '開始時間',
      end_time: '結束時間',
      service_hours: '服務時數',
      care_staff_name: '護理員姓名',
      staff_id: '護理員編號',
      service_fee: '服務費用',
      staff_salary: '護理員工資',
      service_profit: '服務利潤',
      hourly_rate: '每小時收費',
      hourly_salary: '每小時工資',
      service_type: '服務類型',
      project_category: '所屬項目',
      project_manager: '項目經理'
    }

    // 創建CSV內容
    const headers = columns.map(col => columnLabels[col] || col)
    const csvContent = [
      headers.join(','),
      ...records.map(record =>
        columns.map(col => {
          let value = record[col] || ''

          // 特殊處理服務利潤 - 使用 profit 欄位或計算
          if (col === 'service_profit') {
            // 優先使用 profit 欄位（從 API 返回的計算結果）
            if (record.profit !== undefined && record.profit !== null) {
              const profitValue = typeof record.profit === 'number' ? record.profit : parseFloat(String(record.profit))
              value = `$${profitValue.toFixed(2)}`
            } else {
              // 備用計算方式
              const serviceFee = parseFloat(record.service_fee || '0')
              const staffSalary = parseFloat(record.staff_salary || '0')
              value = `$${(serviceFee - staffSalary).toFixed(2)}`
            }
          }
          
          // 處理金額欄位格式化
          if (['service_fee', 'staff_salary', 'hourly_rate', 'hourly_salary'].includes(col)) {
            const numValue = typeof value === 'number' ? value : parseFloat(String(value))
            if (!isNaN(numValue)) {
              value = `$${numValue.toFixed(2)}`
            }
          }

          // 處理包含逗號、引號或換行的值
          const stringValue = String(value)
          if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
            return `"${stringValue.replace(/"/g, '""')}"`
          }
          return stringValue
        }).join(',')
      )
    ].join('\n')

    // 添加BOM以支持中文字符，確保Excel正確顯示
    const BOM = '\uFEFF'
    const blob = new Blob([BOM + csvContent], {
      type: 'text/csv;charset=utf-8;'
    })

    // 下載CSV
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `mingcare_report_${filters.dateRange?.start || 'unknown'}_${filters.dateRange?.end || 'unknown'}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    // 清理URL對象
    URL.revokeObjectURL(url)
  }

  // 使用傳遞下來的 onEdit 和 onDelete props，而不是自己定義編輯邏輯

  const getStaffKey = (staff: StaffOption) => staff.normalizedId || staff.normalizedName
  const getStaffDisplayName = (staff: StaffOption) => staff.staffId ? `${staff.name}（${staff.staffId}）` : staff.name
  const doesRecordBelongToStaff = (record: BillingSalaryRecord, staff: StaffOption) => {
    const recordStaffId = normalizeStaffId(record.staff_id)
    if (staff.normalizedId && recordStaffId) {
      return staff.normalizedId === recordStaffId
    }

    const recordName = normalizeStaffName(record.care_staff_name)
    if (staff.normalizedName && recordName) {
      return staff.normalizedName === recordName
    }

    return false
  }

  const downloadAllStaffPDFs = async () => {
    try {
      // 獲取所有記錄（分批獲取，無上限）
      const response = await fetchAllBillingSalaryRecords(filters)
      if (!response.success || !response.data) {
        alert('無法獲取記錄資料')
        return
      }

      const allRecords = response.data || []
      const selectedColumns = Object.entries(exportColumns)
        .filter(([_, selected]) => selected)
        .map(([column, _]) => column)

      // 設置所有護理員為下載中狀態
      const newStatus: Record<string, string> = {}
      ;(staffList || []).forEach(staff => {
        const key = getStaffKey(staff)
        if (key) {
          newStatus[key] = 'downloading'
        }
      })
      setStaffDownloadStatus(newStatus)

      let successCount = 0
      let failureCount = 0

      // 順序下載每個護理員的PDF（避免同時打開多個窗口）
      for (const staff of staffList) {
        try {
          // 篩選該護理員的記錄
          const staffRecords = allRecords.filter(record => doesRecordBelongToStaff(record, staff))

          if (staffRecords.length === 0) {
            console.warn(`護理員 ${getStaffDisplayName(staff)} 沒有記錄`)
            setStaffDownloadStatus(prev => ({
              ...prev,
              [getStaffKey(staff)]: 'error'
            }))
            failureCount++
            continue
          }

          // 按日期排序
          staffRecords.sort((a, b) => new Date(a.service_date).getTime() - new Date(b.service_date).getTime())

          await generateAndDownloadStaffPDF(staffRecords, selectedColumns, staff)

          // 更新為成功狀態
          setStaffDownloadStatus(prev => ({
            ...prev,
            [getStaffKey(staff)]: 'downloaded'
          }))

          successCount++

          // 短暫延遲避免瀏覽器阻擋彈窗
          await new Promise(resolve => setTimeout(resolve, 1000))

        } catch (error) {
          console.error(`下載護理員 ${getStaffDisplayName(staff)} PDF失敗:`, error)
          setStaffDownloadStatus(prev => ({
            ...prev,
            [getStaffKey(staff)]: 'error'
          }))
          failureCount++
        }
      }

      // 顯示完成總結
      if (successCount > 0 && failureCount === 0) {
        alert(`全部下載完成！成功下載 ${successCount} 個護理員的工資明細`)
      } else if (successCount > 0 && failureCount > 0) {
        alert(`部分下載完成！成功下載 ${successCount} 個，失敗 ${failureCount} 個`)
      } else {
        alert('下載全部失敗，請檢查資料並重試')
      }

    } catch (error) {
      console.error('批量下載失敗:', error)
      alert('批量下載時發生錯誤，請重試')
    }
  }

  if (loading) {
    return <LoadingScreen message="正在載入護理服務資料..." />
  }

  // 護理員列表下載頁面
  if (showStaffListPage) {
    return (
      <div className="min-h-screen bg-bg-primary overflow-auto">
        {/* Header */}
        <header className="card-apple border-b border-border-light fade-in-apple sticky top-0 z-10">
          <div className="px-6 lg:px-8">
            <div className="flex justify-between items-center py-8">
              <div>
                <h1 className="text-apple-title text-text-primary mb-2">工資明細下載</h1>
                <p className="text-apple-body text-text-secondary">選擇護理員下載其工資明細</p>
              </div>
              <button
                onClick={() => setShowStaffListPage(false)}
                className="px-4 py-2 text-primary border border-primary rounded-xl hover:bg-primary hover:text-white transition-all duration-300"
              >
                返回報表
              </button>
            </div>
          </div>
        </header>

        <main className="px-6 lg:px-8 py-8 pb-16">
          <div className="card-apple">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-medium text-text-primary">護理員工資明細</h3>
                {/* 一次過全部下載按鈕 */}
                {!loadingStaff && staffList && staffList.length > 0 && (
                  <button
                    onClick={downloadAllStaffPDFs}
                    disabled={Object.values(staffDownloadStatus).some(status => status === 'downloading')}
                    className={`px-6 py-2 rounded-xl font-medium transition-all duration-300 flex items-center space-x-2 ${
                      Object.values(staffDownloadStatus).some(status => status === 'downloading')
                        ? 'bg-bg-tertiary text-text-secondary border border-border-medium cursor-not-allowed'
                        : 'bg-primary text-white hover:bg-primary-dark active:bg-primary-dark'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span>
                      {Object.values(staffDownloadStatus).some(status => status === 'downloading')
                        ? '下載中...'
                        : '一次過全部下載'
                      }
                    </span>
                  </button>
                )}
              </div>

              {loadingStaff ? (
                <div className="text-center py-12">
                  <p className="text-text-secondary">載入中...</p>
                </div>
              ) : !staffList || staffList.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-text-secondary">沒有找到護理員資料</p>
                </div>
              ) : (
                <div className="space-y-4 max-h-none">
                  {staffList && staffList.map((staff: StaffOption) => {
                    const staffKey = getStaffKey(staff)
                    const isDownloaded = staffDownloadStatus[staffKey] === 'downloaded'
                    const isDownloading = staffDownloadStatus[staffKey] === 'downloading'

                    // 生成文件名：護理員A（ID） YYYY-MM工資明細
                    const fileName = `${getStaffDisplayName(staff)} ${(filters.dateRange?.start || 'unknown').substring(0, 7)}工資明細`

                    return (
                      <div key={staffKey} className="flex items-center justify-between p-4 border border-border-light rounded-xl">
                        <div>
                          <h4 className="font-medium text-text-primary">{fileName}</h4>
                          <p className="text-sm text-text-secondary mt-1">
                            期間：{filters.dateRange?.start || '未設定'} 至 {filters.dateRange?.end || '未設定'}
                          </p>
                        </div>

                        <div className="flex items-center space-x-3">
                          {isDownloaded ? (
                            <>
                              {/* 已下載狀態顯示 */}
                              <div className="px-4 py-2 bg-green-100 text-green-700 border border-green-300 rounded-xl font-medium">
                                已成功下載
                              </div>
                              {/* 再次下載按鈕 */}
                              <button
                                onClick={async () => {
                                  setStaffDownloadStatus(prev => ({
                                    ...prev,
                                    [staffKey]: 'downloading'
                                  }))

                                  try {
                                    // 獲取該護理員的記錄
                                    const response = await fetchAllBillingSalaryRecords(filters)
                                    if (response.success && response.data) {
                                      const selectedColumns = Object.entries(exportColumns)
                                        .filter(([_, selected]) => selected)
                                        .map(([column, _]) => column)

                                      await downloadSingleStaffPDF(staff, response.data || [], selectedColumns)
                                    }
                                  } catch (error) {
                                    console.error('下載失敗:', error)
                                    setStaffDownloadStatus(prev => ({
                                      ...prev,
                                      [staffKey]: 'error'
                                    }))
                                    alert('下載失敗，請重試')
                                  }
                                }}
                                disabled={isDownloading}
                                className="px-4 py-2 bg-blue-100 text-blue-700 border border-blue-300 rounded-xl font-medium hover:bg-blue-200 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                再次下載
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={async () => {
                                if (isDownloading) return

                                setStaffDownloadStatus(prev => ({
                                  ...prev,
                                  [staffKey]: 'downloading'
                                }))

                                try {
                                  // 獲取該護理員的記錄
                                  const response = await fetchAllBillingSalaryRecords(filters)
                                  if (response.success && response.data) {
                                    const selectedColumns = Object.entries(exportColumns)
                                      .filter(([_, selected]) => selected)
                                      .map(([column, _]) => column)

                                    await downloadSingleStaffPDF(staff, response.data || [], selectedColumns)
                                  }
                                } catch (error) {
                                  console.error('下載失敗:', error)
                                  setStaffDownloadStatus(prev => ({
                                    ...prev,
                                    [staffKey]: 'error'
                                  }))
                                  alert('下載失敗，請重試')
                                }
                              }}
                              disabled={isDownloading}
                              className={`px-6 py-2 rounded-xl font-medium transition-all duration-300 ${
                                isDownloading
                                ? 'bg-bg-tertiary text-text-secondary border border-border-medium cursor-not-allowed'
                                : 'bg-primary text-white hover:bg-primary-dark active:bg-primary-dark'
                              }`}
                            >
                              {isDownloading ? '下載中...' : '下載'}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Header */}
      <header className="card-apple border-b border-border-light fade-in-apple">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center py-4 sm:py-6 lg:py-8 space-y-4 sm:space-y-0">
            <div className="flex items-start gap-4">
              <div>
                <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-text-primary mb-1 sm:mb-2">護理服務管理</h1>
                <p className="text-sm sm:text-base text-text-secondary">安排護理服務、管理服務排程及記錄</p>
              </div>
              <LastUpdateIndicator lastUpdateTime={lastUpdateTime} />
            </div>
            <button
              onClick={() => router.push('/dashboard')}
              className="btn-apple-secondary text-xs sm:text-sm self-start sm:self-auto"
            >
              返回主頁
            </button>
          </div>
        </div>
      </header>

      <main className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
        {/* Tab 導航 - 移動端優化 */}
        <div className="mb-4 sm:mb-6 lg:mb-8">
          <div className="card-apple border border-border-light fade-in-apple">
            <div className="p-3 sm:p-4">
              <nav className="flex space-x-2 sm:space-x-3 bg-bg-tertiary/60 p-1.5 rounded-2xl">
                {/* 1. 詳細報表 */}
                <button
                  onClick={() => setActiveTab('reports')}
                  className={`flex-1 py-2.5 sm:py-3 px-3 sm:px-5 rounded-xl font-medium text-xs sm:text-sm transition-all duration-300 flex items-center justify-center space-x-1.5 sm:space-x-2 ${
                    activeTab === 'reports'
                      ? 'bg-white text-primary shadow-md'
                      : 'text-text-secondary hover:text-text-primary hover:bg-white/50'
                  }`}
                >
                  <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="hidden sm:inline">詳細報表</span>
                  <span className="sm:hidden">報表</span>
                </button>

                {/* 2. 排程管理 */}
                <button
                  onClick={() => setActiveTab('schedule')}
                  className={`flex-1 py-2.5 sm:py-3 px-3 sm:px-5 rounded-xl font-medium text-xs sm:text-sm transition-all duration-300 flex items-center justify-center space-x-1.5 sm:space-x-2 ${
                    activeTab === 'schedule'
                      ? 'bg-white text-primary shadow-md'
                      : 'text-text-secondary hover:text-text-primary hover:bg-white/50'
                  }`}
                >
                  <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="hidden sm:inline">排程管理</span>
                  <span className="sm:hidden">排程</span>
                </button>

                {/* 3. 業務概覽 */}
                <button
                  onClick={() => setActiveTab('overview')}
                  className={`flex-1 py-2.5 sm:py-3 px-3 sm:px-5 rounded-xl font-medium text-xs sm:text-sm transition-all duration-300 flex items-center justify-center space-x-1.5 sm:space-x-2 ${
                    activeTab === 'overview'
                      ? 'bg-white text-primary shadow-md'
                      : 'text-text-secondary hover:text-text-primary hover:bg-white/50'
                  }`}
                >
                  <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <span className="hidden sm:inline">業務概覽</span>
                  <span className="sm:hidden">概覽</span>
                </button>
              </nav>
            </div>
          </div>
        </div>

        {/* Tab 內容 */}
        {activeTab === 'overview' && (
          <OverviewTab
            filters={filters}
            setFilters={setFilters}
            updateDateRange={updateDateRange}
            kpiData={kpiData}
            kpiLoading={kpiLoading}
            categorySummary={categorySummary}
          />
        )}

        {activeTab === 'schedule' && (
          <ScheduleTab 
            filters={filters} 
            onCalendarExport={handleCalendarExport}
            calendarExportLoading={calendarExportLoading}
          />
        )}

        {activeTab === 'reports' && (
          <ReportsTab
            filters={filters}
            setFilters={setFilters}
            updateDateRange={updateDateRange}
            exportLoading={exportLoading}
            handleExport={handleExport}
            onCalendarExport={handleCalendarExport}
            calendarExportLoading={calendarExportLoading}
            onEdit={handleEdit}
            onDelete={handleDelete}
            refreshTrigger={refreshTrigger}
            onRefresh={handleRefresh}
            recordUpdateTimes={recordUpdateTimes}
          />
        )}
      </main>

      {/* 編輯模態框 */}
      {isEditModalOpen && editingRecord && (
        <ScheduleFormModal
          isOpen={isEditModalOpen}
          onClose={handleEditCancel}
          onSubmit={handleEditSave}
          onDelete={handleDelete}
          existingRecord={editingRecord}
        />
      )}

      {/* 導出選項模態框 */}
      {showExportModal && (
        <>
          {typeof window !== 'undefined' && createPortal(
            <div
              className="fixed inset-0 z-[9999] overflow-y-auto"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) {
                  setShowExportModal(false)
                }
              }}
            >
              {/* 背景遮罩 */}
              <div className="fixed inset-0 bg-black/60 transition-opacity" />

              {/* Modal 容器 */}
              <div className="fixed inset-0 flex items-center justify-center p-4">
                <div
                  className="relative card-apple w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {/* Header */}
                  <div className="p-6 border-b border-border-light flex-shrink-0 bg-bg-secondary/30">
                    <h3 className="text-lg font-semibold text-text-primary">導出設定</h3>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto p-6">
                    {/* 預設模式選擇 */}
                    <div className="mb-6">
                      <label className="block text-sm font-semibold text-text-primary mb-3">預設模式</label>
                      <div className="space-y-3">
                        {Object.entries(exportModeConfigs).map(([mode, config]) => (
                          <label key={mode} className={`flex items-start p-3 rounded-xl border transition-all duration-300 cursor-pointer ${
                            exportMode === mode
                              ? 'border-primary bg-primary/5'
                              : 'border-border-light hover:border-primary/50 hover:bg-bg-secondary'
                          }`}>
                            <input
                              type="radio"
                              name="exportMode"
                              value={mode}
                              checked={exportMode === mode}
                              onChange={(e) => handleExportModeChange(e.target.value as 'accounting' | 'payroll')}
                              className="mr-3 mt-1 accent-primary"
                            />
                            <div>
                              <div className="font-medium text-text-primary">{config.name}</div>
                              <div className="text-sm text-text-secondary">{config.description}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* 格式選擇 */}
                    <div className="mb-6">
                      <label className="block text-sm font-semibold text-text-primary mb-3">導出格式</label>
                      <div className="flex space-x-3">
                        <label className={`flex-1 flex items-center justify-center p-3 rounded-xl border transition-all duration-300 cursor-pointer ${
                          exportFormat === 'pdf'
                            ? 'border-primary bg-primary/5'
                            : 'border-border-light hover:border-primary/50'
                        }`}>
                          <input
                            type="radio"
                            name="format"
                            value="pdf"
                            checked={exportFormat === 'pdf'}
                            onChange={(e) => setExportFormat(e.target.value as 'pdf' | 'csv')}
                            className="mr-2 accent-primary"
                          />
                          <span className="font-medium">PDF</span>
                        </label>
                        <label className={`flex-1 flex items-center justify-center p-3 rounded-xl border transition-all duration-300 cursor-pointer ${
                          exportFormat === 'csv'
                            ? 'border-primary bg-primary/5'
                            : 'border-border-light hover:border-primary/50'
                        }`}>
                          <input
                            type="radio"
                            name="format"
                            value="csv"
                            checked={exportFormat === 'csv'}
                            onChange={(e) => setExportFormat(e.target.value as 'pdf' | 'csv')}
                            className="mr-2 accent-primary"
                          />
                          <span className="font-medium">CSV</span>
                        </label>
                      </div>
                    </div>

                    {/* 工資模式子選項 */}
                    {exportMode === 'payroll' && exportFormat === 'pdf' && (
                      <div className="mb-6">
                        <label className="block text-sm font-semibold text-text-primary mb-3">工資導出方式</label>
                        <div className="space-y-2">
                          <label className={`flex items-center p-3 rounded-xl border transition-all duration-300 cursor-pointer ${
                            payrollExportType === 'combined'
                              ? 'border-primary bg-primary/5'
                              : 'border-border-light hover:border-primary/50'
                          }`}>
                            <input
                              type="radio"
                              name="payrollType"
                              value="combined"
                              checked={payrollExportType === 'combined'}
                              onChange={(e) => setPayrollExportType(e.target.value as 'separate' | 'combined')}
                              className="mr-2 accent-primary"
                            />
                            <span>合併報表 (一個PDF包含所有人員)</span>
                          </label>
                          <label className={`flex items-center p-3 rounded-xl border transition-all duration-300 cursor-pointer ${
                            payrollExportType === 'separate'
                              ? 'border-primary bg-primary/5'
                              : 'border-border-light hover:border-primary/50'
                          }`}>
                            <input
                              type="radio"
                              name="payrollType"
                              value="separate"
                              checked={payrollExportType === 'separate'}
                              onChange={(e) => setPayrollExportType(e.target.value as 'separate' | 'combined')}
                              className="mr-2"
                            />
                            <span>個別報表 (每人單獨PDF檔案)</span>
                          </label>
                        </div>
                      </div>
                    )}

                    {/* 欄位選擇 */}
                    <div className="mb-6">
                      <label className="block text-sm font-medium text-text-primary mb-3">
                        選擇要導出的欄位
                        <span className="text-xs text-text-secondary ml-2">
                          ({exportModeConfigs[exportMode].name} 預設配置，可自由調整)
                        </span>
                      </label>
                      <div className="space-y-2 max-h-48 overflow-y-auto border border-border-light rounded-xl p-3 bg-bg-secondary">
                        {Object.entries({
                          service_date: '服務日期',
                          customer_id: '客戶編號',
                          customer_name: '客戶姓名',
                          phone: '客戶電話',
                          service_address: '服務地址',
                          start_time: '開始時間',
                          end_time: '結束時間',
                          service_hours: '服務時數',
                          care_staff_name: '護理員姓名',
                          service_fee: '服務費用',
                          staff_salary: '護理員工資',
                          service_profit: '服務利潤',
                          hourly_rate: '每小時收費',
                          hourly_salary: '每小時工資',
                          service_type: '服務類型',
                          project_category: '所屬項目',
                          project_manager: '項目經理'
                        }).map(([key, label]) => {
                          const isDefaultField = ['service_date', 'customer_name', 'service_address', 'start_time', 'end_time', 'service_hours', 'care_staff_name', 'service_type'].includes(key)
                          return (
                            <label key={key} className="flex items-center">
                              <input
                                type="checkbox"
                                checked={exportColumns[key as keyof typeof exportColumns]}
                                onChange={(e) => {
                                  setExportColumns(prev => ({
                                    ...prev,
                                    [key]: e.target.checked
                                  }))
                                }}
                                className="mr-2"
                              />
                              <span className={`text-sm ${isDefaultField ? 'font-medium text-primary' : ''}`}>
                                {label}
                                {isDefaultField && <span className="text-xs text-primary ml-1">(默認)</span>}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Footer Buttons */}
                  <div className="p-6 border-t border-border-light flex justify-end space-x-3 flex-shrink-0 bg-bg-secondary/30">
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => setShowExportModal(false)}
                      className="btn-apple-secondary"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={handleExportConfirm}
                      disabled={Object.values(exportColumns).every(v => !v)}
                      className="btn-apple-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      確認導出
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}
        </>
      )}
    </div>
  )
}

// 排班表單 Modal 組件
interface ScheduleFormModalProps {
  isOpen: boolean
  onClose: () => void
  selectedDate?: string | null
  selectedDates?: string[]
  onSubmit: (formData: BillingSalaryFormData) => Promise<void>
  onDelete?: (recordId: string) => Promise<void>
  isMultiDay?: boolean
  existingRecord?: BillingSalaryRecord | null
  // 預選客戶資料 - 從外部選擇器傳入
  preselectedCustomer?: {
    customer_id: string
    customer_name: string
    phone: string
    service_address: string
    project_category?: string
  } | null
}

function ScheduleFormModal({
  isOpen,
  onClose,
  selectedDate,
  selectedDates = [],
  onSubmit,
  onDelete,
  isMultiDay = false,
  existingRecord = null,
  preselectedCustomer = null
}: ScheduleFormModalProps) {
  // 初始化表單數據
  const getInitialFormData = (): BillingSalaryFormData => {
    if (existingRecord) {
      // 編輯模式：使用現有記錄的數據，確保日期格式一致
      return {
        service_date: existingRecord.service_date, // 保持原有格式，因為已經是字符串
        customer_id: existingRecord.customer_id,
        customer_name: existingRecord.customer_name,
        phone: existingRecord.phone,
        service_address: existingRecord.service_address,
        start_time: existingRecord.start_time,
        end_time: existingRecord.end_time,
        service_hours: existingRecord.service_hours,
        staff_id: existingRecord.staff_id,
        care_staff_name: existingRecord.care_staff_name,
        service_fee: existingRecord.service_fee,
        staff_salary: existingRecord.staff_salary,
        hourly_rate: existingRecord.hourly_rate || 0,
        hourly_salary: existingRecord.hourly_salary || 0,
        service_type: existingRecord.service_type,
        project_category: existingRecord.project_category,
        project_manager: existingRecord.project_manager
      }
    } else if (preselectedCustomer) {
      // 新增模式 + 有預選客戶：使用預選客戶資料
      return {
        service_date: selectedDate || formatDateSafely(new Date()),
        customer_id: preselectedCustomer.customer_id,
        customer_name: preselectedCustomer.customer_name,
        phone: preselectedCustomer.phone,
        service_address: preselectedCustomer.service_address,
        start_time: '09:00',
        end_time: '17:00',
        service_hours: 8,
        staff_id: '',
        care_staff_name: '',
        service_fee: 0,
        staff_salary: 0,
        hourly_rate: 0,
        hourly_salary: 0,
        service_type: '',
        project_category: (preselectedCustomer.project_category || '') as ProjectCategory | '',
        project_manager: ''
      }
    } else {
      // 新增模式：使用默認值
      return {
        service_date: selectedDate || formatDateSafely(new Date()),
        customer_id: '',
        customer_name: '',
        phone: '',
        service_address: '',
        start_time: '09:00',
        end_time: '17:00',
        service_hours: 8,
        staff_id: '',
        care_staff_name: '',
        service_fee: 0,
        staff_salary: 0,
        hourly_rate: 0,
        hourly_salary: 0,
        service_type: '',
        project_category: '',
        project_manager: ''
      }
    }
  }

  const [formData, setFormData] = useState<BillingSalaryFormData>(getInitialFormData)

  // 當existingRecord或preselectedCustomer改變時重新初始化表單
  useEffect(() => {
    setFormData(getInitialFormData())
    // 同時更新搜索項
    if (existingRecord) {
      setCustomerSearchTerm(existingRecord.customer_name)
      setStaffSearchTerm(existingRecord.care_staff_name)
      
      // 載入護理人員薪資歷史記錄
      if (existingRecord.staff_id) {
        loadStaffSalaryHistory(existingRecord.staff_id)
      }
    } else if (preselectedCustomer) {
      setCustomerSearchTerm(preselectedCustomer.customer_name)
      setStaffSearchTerm('')
      setStaffSalaryHistory([])
    } else {
      setCustomerSearchTerm('')
      setStaffSearchTerm('')
      setStaffSalaryHistory([])
    }
  }, [existingRecord, selectedDate, preselectedCustomer])

  // 載入護理人員薪資歷史記錄的函數
  const loadStaffSalaryHistory = async (staffId: string) => {
    if (!staffId) {
      setStaffSalaryHistory([])
      return
    }

    setStaffSalaryHistoryLoading(true)
    try {
      const { data, error } = await supabase
        .from('billing_salary_data')
        .select('service_date, customer_name, staff_salary, hourly_salary')
        .eq('staff_id', staffId)
        .order('service_date', { ascending: false })
        .limit(5)

      if (error) {
        console.error('查詢護理人員薪資歷史失敗:', error)
        setStaffSalaryHistory([])
      } else {
        setStaffSalaryHistory(data || [])
      }
    } catch (error) {
      console.error('查詢護理人員薪資歷史錯誤:', error)
      setStaffSalaryHistory([])
    } finally {
      setStaffSalaryHistoryLoading(false)
    }
  }

  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // 搜尋功能狀態
  const [customerSearchTerm, setCustomerSearchTerm] = useState(existingRecord ? existingRecord.customer_name : '')
  const [customerSuggestions, setCustomerSuggestions] = useState<CustomerSearchResult[]>([])
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false)

  const [staffSearchTerm, setStaffSearchTerm] = useState(existingRecord ? existingRecord.care_staff_name : '')
  const [staffSuggestions, setStaffSuggestions] = useState<any[]>([])
  const [showStaffSuggestions, setShowStaffSuggestions] = useState(false)

  // 護理人員薪資歷史記錄狀態
  const [staffSalaryHistory, setStaffSalaryHistory] = useState<{
    service_date: string
    customer_name: string
    staff_salary: number
    hourly_salary: number
  }[]>([])
  const [staffSalaryHistoryLoading, setStaffSalaryHistoryLoading] = useState(false)

  // 客戶歷史護理人員狀態
  const [customerStaffHistory, setCustomerStaffHistory] = useState<{
    staff_id: string
    care_staff_name: string
    service_date: string
    service_count: number
  }[]>([])
  const [customerStaffHistoryLoading, setCustomerStaffHistoryLoading] = useState(false)

  // 選擇客戶彈窗狀態
  const [showCustomerPicker, setShowCustomerPicker] = useState(false)
  const [pickerMonth, setPickerMonth] = useState(() => {
    // 根據排班日期自動設定月份
    const targetDate = selectedDate || (selectedDates.length > 0 ? selectedDates[0] : null)
    if (targetDate) {
      // targetDate 格式為 YYYY-MM-DD
      const [year, month] = targetDate.split('-')
      return `${year}-${month}`
    }
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [pickerCategory, setPickerCategory] = useState<string>('')
  const [pickerProjectCategory, setPickerProjectCategory] = useState<string>('')
  const [pickerShowAll, setPickerShowAll] = useState(false)
  const [pickerCustomerList, setPickerCustomerList] = useState<{
    customer_id: string
    customer_name: string
    phone: string
    service_address: string
    customer_type: string
    project_category: string
    hasLastMonthService: boolean
    hasCurrentMonthSchedule: boolean
  }[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)

  // 載入客戶列表
  const loadPickerCustomers = async () => {
    setPickerLoading(true)
    try {
      // 解析月份
      const [year, month] = pickerMonth.split('-').map(Number)
      const currentMonthStart = `${year}-${String(month).padStart(2, '0')}-01`
      const currentMonthEnd = `${year}-${String(month).padStart(2, '0')}-31`
      
      // 上月
      const lastMonth = month === 1 ? 12 : month - 1
      const lastMonthYear = month === 1 ? year - 1 : year
      const lastMonthStart = `${lastMonthYear}-${String(lastMonth).padStart(2, '0')}-01`
      const lastMonthEnd = `${lastMonthYear}-${String(lastMonth).padStart(2, '0')}-31`

      // 查詢客戶資料（包含 customer_type）
      let customerQuery = supabase
        .from('customer_personal_data')
        .select('customer_id, customer_name, phone, service_address, customer_type')

      const { data: customers, error: customerError } = await customerQuery

      if (customerError) {
        console.error('查詢客戶失敗:', customerError)
        setPickerCustomerList([])
        return
      }

      // 查詢上月有服務的客戶
      const { data: lastMonthRecords } = await supabase
        .from('billing_salary_data')
        .select('customer_id, customer_name, project_category')
        .gte('service_date', lastMonthStart)
        .lte('service_date', lastMonthEnd)

      // 查詢當月已排更的客戶
      const { data: currentMonthRecords } = await supabase
        .from('billing_salary_data')
        .select('customer_id, customer_name, project_category')
        .gte('service_date', currentMonthStart)
        .lte('service_date', currentMonthEnd)

      // 定義記錄類型
      type BillingRecord = { customer_id: string | null; customer_name: string | null; project_category: string | null }
      type CustomerRecord = { customer_id: string; customer_name: string; phone: string | null; service_address: string | null; customer_type: string | null }

      // 建立上月服務客戶 Set
      const lastMonthCustomers = new Set(
        ((lastMonthRecords || []) as BillingRecord[]).map(r => r.customer_id || r.customer_name)
      )

      // 建立當月已排更客戶 Set
      const currentMonthCustomers = new Set(
        ((currentMonthRecords || []) as BillingRecord[]).map(r => r.customer_id || r.customer_name)
      )

      // 建立客戶 project_category Map（從 billing 記錄取得）
      const customerProjectCategoryMap = new Map<string, string>()
      ;([...(lastMonthRecords || []), ...(currentMonthRecords || [])] as BillingRecord[]).forEach(r => {
        if ((r.customer_id || r.customer_name) && r.project_category) {
          customerProjectCategoryMap.set(r.customer_id || r.customer_name || '', r.project_category)
        }
      })

      // 組合客戶列表（排除家訪客戶）
      let result = ((customers || []) as CustomerRecord[])
        .filter(c => c.customer_type !== '家訪客戶') // 排除家訪客戶
        .map(c => ({
          customer_id: c.customer_id,
          customer_name: c.customer_name,
          phone: c.phone || '',
          service_address: c.service_address || '',
          customer_type: c.customer_type || '',
          project_category: customerProjectCategoryMap.get(c.customer_id) || customerProjectCategoryMap.get(c.customer_name) || '',
          hasLastMonthService: lastMonthCustomers.has(c.customer_id) || lastMonthCustomers.has(c.customer_name),
          hasCurrentMonthSchedule: currentMonthCustomers.has(c.customer_id) || currentMonthCustomers.has(c.customer_name)
        }))

      // 篩選客戶類型
      if (pickerCategory) {
        result = result.filter(c => c.customer_type === pickerCategory)
      }

      // 篩選所屬項目
      if (pickerProjectCategory) {
        result = result.filter(c => c.project_category === pickerProjectCategory)
      }

      // 只顯示上月有服務的
      if (!pickerShowAll) {
        result = result.filter(c => c.hasLastMonthService)
      }

      // 排序：上月有服務的先顯示
      result.sort((a, b) => {
        if (a.hasLastMonthService && !b.hasLastMonthService) return -1
        if (!a.hasLastMonthService && b.hasLastMonthService) return 1
        return a.customer_name.localeCompare(b.customer_name, 'zh-Hant')
      })

      setPickerCustomerList(result)
    } catch (error) {
      console.error('載入客戶列表失敗:', error)
      setPickerCustomerList([])
    } finally {
      setPickerLoading(false)
    }
  }

  // 當篩選條件改變時重新載入
  useEffect(() => {
    if (showCustomerPicker) {
      loadPickerCustomers()
    }
  }, [showCustomerPicker, pickerMonth, pickerCategory, pickerProjectCategory, pickerShowAll])

  // 計算機狀態
  const [showCalculator, setShowCalculator] = useState(false)
  const [calcDisplay, setCalcDisplay] = useState('0')
  const [calcPrevValue, setCalcPrevValue] = useState<number | null>(null)
  const [calcOperation, setCalcOperation] = useState<string | null>(null)
  const [calcWaitingForOperand, setCalcWaitingForOperand] = useState(false)

  // 計算機函數
  const calcInputDigit = (digit: string) => {
    if (calcWaitingForOperand) {
      setCalcDisplay(digit)
      setCalcWaitingForOperand(false)
    } else {
      setCalcDisplay(calcDisplay === '0' ? digit : calcDisplay + digit)
    }
  }

  const calcInputDot = () => {
    if (calcWaitingForOperand) {
      setCalcDisplay('0.')
      setCalcWaitingForOperand(false)
    } else if (!calcDisplay.includes('.')) {
      setCalcDisplay(calcDisplay + '.')
    }
  }

  const calcClear = () => {
    setCalcDisplay('0')
    setCalcPrevValue(null)
    setCalcOperation(null)
    setCalcWaitingForOperand(false)
  }

  const calcPerformOperation = (nextOperation: string) => {
    const inputValue = parseFloat(calcDisplay)

    if (calcPrevValue === null) {
      setCalcPrevValue(inputValue)
    } else if (calcOperation) {
      const currentValue = calcPrevValue || 0
      let result = currentValue

      switch (calcOperation) {
        case '+': result = currentValue + inputValue; break
        case '-': result = currentValue - inputValue; break
        case '×': result = currentValue * inputValue; break
        case '÷': result = inputValue !== 0 ? currentValue / inputValue : 0; break
      }

      setCalcDisplay(String(Math.round(result * 100000000) / 100000000))
      setCalcPrevValue(result)
    }

    setCalcWaitingForOperand(true)
    setCalcOperation(nextOperation)
  }

  const calcEquals = () => {
    if (!calcOperation || calcPrevValue === null) return

    const inputValue = parseFloat(calcDisplay)
    const currentValue = calcPrevValue
    let result = currentValue

    switch (calcOperation) {
      case '+': result = currentValue + inputValue; break
      case '-': result = currentValue - inputValue; break
      case '×': result = currentValue * inputValue; break
      case '÷': result = inputValue !== 0 ? currentValue / inputValue : 0; break
    }

    setCalcDisplay(String(Math.round(result * 100000000) / 100000000))
    setCalcPrevValue(null)
    setCalcOperation(null)
    setCalcWaitingForOperand(true)
  }

  // 搜尋防抖定時器
  const [customerSearchTimeout, setCustomerSearchTimeout] = useState<NodeJS.Timeout | null>(null)
  const [staffSearchTimeout, setStaffSearchTimeout] = useState<NodeJS.Timeout | null>(null)

  // 清理定時器
  useEffect(() => {
    console.log('ScheduleFormModal組件已掛載') // 調試日誌
    return () => {
      console.log('ScheduleFormModal組件將卸載') // 調試日誌
      if (customerSearchTimeout) {
        clearTimeout(customerSearchTimeout)
      }
      if (staffSearchTimeout) {
        clearTimeout(staffSearchTimeout)
      }
    }
  }, [customerSearchTimeout, staffSearchTimeout])

  // 點擊外部關閉搜尋建議
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.customer-search-container')) {
        setShowCustomerSuggestions(false)
      }
      if (!target.closest('.staff-search-container')) {
        setShowStaffSuggestions(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 點擊外部關閉搜尋建議
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.customer-search-container')) {
        setShowCustomerSuggestions(false)
      }
      if (!target.closest('.staff-search-container')) {
        setShowStaffSuggestions(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 檢查是否為多日期排班（使用參數中的isMultiDay或根據selectedDates計算）
  const isMultipleDays = isMultiDay || selectedDates.length > 1

  // 表單驗證
  const validateForm = (data: BillingSalaryFormData): Record<string, string> => {
    const errors: Record<string, string> = {}

    if (!data.customer_name.trim()) errors.customer_name = '客戶姓名不能為空'
    if (!data.phone.trim()) errors.phone = '聯絡電話不能為空'
    if (!data.service_address.trim()) errors.service_address = '服務地址不能為空'
    if (!data.care_staff_name.trim()) errors.care_staff_name = '護理人員不能為空'
    if (!data.staff_id?.trim()) errors.staff_id = '請透過搜尋選擇護理人員'
    if (data.service_fee == null || data.service_fee < 0) errors.service_fee = '服務費用不能為空或負數'
    if (data.staff_salary == null || data.staff_salary < 0) errors.staff_salary = '員工薪資不能為空或負數'
    if (data.service_hours == null || data.service_hours < 0) errors.service_hours = '服務時數不能為空或負數'
    if (!data.service_type) errors.service_type = '請選擇服務類型'
    if (!data.project_category) errors.project_category = '請選擇項目分類'
    if (!data.project_manager) errors.project_manager = '請選擇項目負責人'

    // 時間邏輯檢查已移除 - 現在支援跨夜更（例如：23:00-07:00）

    return errors
  }

  // 計算服務時數（支援跨夜更）
  const calculateServiceHours = (startTime: string, endTime: string): number => {
    const [startHour, startMin] = startTime.split(':').map(Number)
    const [endHour, endMin] = endTime.split(':').map(Number)

    let startMinutes = startHour * 60 + startMin
    let endMinutes = endHour * 60 + endMin

    // 跨夜更：結束時間小於開始時間，加24小時（1440分鐘）
    if (endMinutes < startMinutes) {
      endMinutes += 1440
    }

    return Math.max(0, (endMinutes - startMinutes) / 60)
  }

  // 處理表單提交
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      const formErrors = validateForm(formData)

      if (Object.keys(formErrors).length > 0) {
        setErrors(formErrors)
        return
      }

      setErrors({})

      // 準備提交的資料，讓資料庫自動計算 hourly_rate 和 hourly_salary
      const submitData: Omit<BillingSalaryFormData, 'hourly_rate' | 'hourly_salary'> = {
        service_date: formData.service_date,
        customer_id: formData.customer_id,
        customer_name: formData.customer_name,
        phone: formData.phone,
        service_address: formData.service_address,
        start_time: formData.start_time,
        end_time: formData.end_time,
        service_hours: formData.service_hours,
        staff_id: formData.staff_id,
        care_staff_name: formData.care_staff_name,
        service_fee: formData.service_fee,
        staff_salary: formData.staff_salary,
        service_type: formData.service_type,
        project_category: formData.project_category,
        project_manager: formData.project_manager
      }

      await onSubmit(submitData as BillingSalaryFormData)
      onClose()
    } catch (error) {
      console.error('提交表單失敗:', error)
      const errorMessage = error instanceof Error ? error.message : '未知錯誤'
      alert(`提交表單失敗: ${errorMessage}`)
    } finally {
      setSubmitting(false)
    }
  }

  // 更新表單欄位
  const updateField = (field: string, value: any) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value }

      if (field === 'care_staff_name') {
        updated.staff_id = ''
      }

      // 處理日期欄位，確保格式一致
      if (field === 'service_date' && value) {
        // 如果是日期字符串，確保格式正確
        if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}$/)) {
          updated.service_date = value // 已經是正確格式
        }
      }

      // 自動計算服務時數（當開始或結束時間改變時）
      if (field === 'start_time' || field === 'end_time') {
        if (updated.start_time && updated.end_time) {
          const calculatedHours = calculateServiceHours(updated.start_time, updated.end_time)
          const roundedHours = Math.round(calculatedHours * 2) / 2 // 四捨五入到 0.5
          updated.service_hours = roundedHours
        }
      }

      // 自動計算每小時收費和時薪薪資（僅用於顯示）
      // 使用 Math.round 修復浮點數精度問題，避免出現 139.99 這類數值
      if (field === 'service_fee' || field === 'staff_salary' || field === 'service_hours') {
        if (updated.service_hours > 0) {
          updated.hourly_rate = Math.round(((updated.service_fee || 0) / updated.service_hours) * 100) / 100
          updated.hourly_salary = Math.round(((updated.staff_salary || 0) / updated.service_hours) * 100) / 100
        }
      }

      return updated
    })

    // 同步更新搜索項
    if (field === 'customer_name') {
      setCustomerSearchTerm(value)
    } else if (field === 'care_staff_name') {
      setStaffSearchTerm(value)
    }
  }

  // 內部客戶搜尋功能
  const handleFormCustomerSearch = async (searchTerm: string) => {
    console.log('表單客戶搜尋開始:', searchTerm) // 調試日誌
    setCustomerSearchTerm(searchTerm)

    if (searchTerm.trim().length < 1) {
      setCustomerSuggestions([])
      setShowCustomerSuggestions(false)
      return
    }

    try {
      console.log('使用 Supabase 直接進行表單客戶搜尋') // 調試日誌

      // 直接使用 Supabase 客戶端查詢（正確的表名和欄位名）
      const { data, error } = await supabase
        .from('customer_personal_data')
        .select('customer_id, customer_name, phone, service_address')
        .or(`customer_name.ilike.%${searchTerm.trim()}%,customer_id.ilike.%${searchTerm.trim()}%,phone.ilike.%${searchTerm.trim()}%,service_address.ilike.%${searchTerm.trim()}%`)
        .limit(10)

      if (error) {
        console.error('Supabase 表單客戶搜尋錯誤:', error)
        setCustomerSuggestions([])
        setShowCustomerSuggestions(false)
        return
      }

      // 轉換為 CustomerSearchResult 格式
      const suggestions: CustomerSearchResult[] = (data || []).map((item: any) => ({
        customer_id: item.customer_id || '',
        customer_name: item.customer_name || '',
        phone: item.phone || '',
        service_address: item.service_address || '',
        display_text: item.customer_name || '',
        type: 'customer' as const
      }))

      console.log('表單客戶搜尋結果:', suggestions) // 調試日誌
      setCustomerSuggestions(suggestions)
      setShowCustomerSuggestions(true)

    } catch (error) {
      console.error('客戶搜尋失敗:', error)
      setCustomerSuggestions([])
      setShowCustomerSuggestions(false)
    }
  }

  // 選擇客戶
  const selectCustomer = async (customer: CustomerSearchResult) => {
    updateField('customer_name', customer.customer_name || customer.display_text)
    updateField('customer_id', customer.customer_id || '')
    updateField('phone', customer.phone || '')
    updateField('service_address', customer.service_address || '')
    setCustomerSearchTerm(customer.customer_name || customer.display_text)
    setShowCustomerSuggestions(false)

    // 查詢該客戶最近 5 次服務的護理人員
    if (customer.customer_id || customer.customer_name) {
      setCustomerStaffHistoryLoading(true)
      try {
        const { data, error } = await supabase
          .from('billing_salary_data')
          .select('staff_id, care_staff_name, service_date')
          .or(`customer_id.eq.${customer.customer_id},customer_name.eq.${customer.customer_name}`)
          .order('service_date', { ascending: false })
          .limit(20)

        if (error) {
          console.error('查詢客戶歷史護理人員失敗:', error)
          setCustomerStaffHistory([])
        } else {
          // 去重並統計服務次數，取最近 5 個不同的護理人員
          const staffMap = new Map<string, { staff_id: string, care_staff_name: string, service_date: string, service_count: number }>()
          for (const record of data || []) {
            if (record.staff_id && record.care_staff_name) {
              const existing = staffMap.get(record.staff_id)
              if (existing) {
                existing.service_count++
              } else {
                staffMap.set(record.staff_id, {
                  staff_id: record.staff_id,
                  care_staff_name: record.care_staff_name,
                  service_date: record.service_date,
                  service_count: 1
                })
              }
            }
          }
          // 取前 5 個
          setCustomerStaffHistory(Array.from(staffMap.values()).slice(0, 5))
        }
      } catch (error) {
        console.error('查詢客戶歷史護理人員錯誤:', error)
        setCustomerStaffHistory([])
      } finally {
        setCustomerStaffHistoryLoading(false)
      }
    } else {
      setCustomerStaffHistory([])
    }
  }

  // 護理人員搜尋功能
  const handleStaffSearch = async (searchTerm: string) => {
    console.log('護理人員搜尋開始:', searchTerm) // 調試日誌
    setStaffSearchTerm(searchTerm)

    if (searchTerm.trim().length < 1) {
      setStaffSuggestions([])
      setShowStaffSuggestions(false)
      return
    }

    try {
      console.log('使用 Supabase 直接進行護理人員搜尋') // 調試日誌

      // 直接使用 Supabase 客戶端查詢
      const { data, error } = await supabase
        .from('care_staff_profiles')
        .select('name_chinese, name_english, staff_id, phone')
        .or(`name_chinese.ilike.%${searchTerm.trim()}%,name_english.ilike.%${searchTerm.trim()}%,staff_id.ilike.%${searchTerm.trim()}%,phone.ilike.%${searchTerm.trim()}%`)
        .limit(10)

      if (error) {
        console.error('Supabase 護理人員搜尋錯誤:', error)
        setStaffSuggestions([])
        setShowStaffSuggestions(false)
        return
      }

      const results = (data || []).map((item: any) => ({
        name_chinese: item.name_chinese || '',
        name_english: item.name_english || '',
        staff_id: item.staff_id || '',
        phone: item.phone || ''
      }))

      console.log('護理人員搜尋結果:', results) // 調試日誌
      setStaffSuggestions(results)
      setShowStaffSuggestions(true)

    } catch (error) {
      console.error('護理人員搜尋失敗:', error)
      setStaffSuggestions([])
      setShowStaffSuggestions(false)
    }
  }

  // 選擇護理人員
  const selectStaff = async (staff: any) => {
    updateField('care_staff_name', staff.name_chinese)
    updateField('staff_id', staff.staff_id || '')
    setStaffSearchTerm(staff.name_chinese)
    setShowStaffSuggestions(false)

    // 查詢該護理人員最近 5 次的薪資記錄
    await loadStaffSalaryHistory(staff.staff_id || '')
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 z-[9999]" onClick={onClose}>
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg-primary rounded-xl w-[calc(100%-2rem)] max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="p-6 border-b border-border-light">
          <h3 className="text-lg font-medium text-text-primary">
            {existingRecord
              ? `編輯排班 - ${existingRecord.service_date}`
              : isMultipleDays
                ? `批量新增排班 (${selectedDates.length} 天)`
                : `新增排班 - ${selectedDate}`
            }
          </h3>

          {isMultipleDays && (
            <div className="mt-2 text-sm text-text-secondary">
              選定日期：{selectedDates.sort().join(', ')}
            </div>
          )}
        </div>

        {/* Form Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 卡片 0：服務日期（編輯模式時顯示） */}
            {existingRecord && (
              <div className="card-apple border border-border-light">
                <div className="p-6">
                  <h4 className="text-apple-heading text-text-primary mb-4">服務日期</h4>
                  <div>
                    <label className="block text-apple-caption font-medium text-text-primary mb-2">
                      日期 <span className="text-danger">*</span>
                    </label>
                    <input
                      type="date"
                      value={formData.service_date}
                      onChange={(e) => updateField('service_date', e.target.value)}
                      className={`form-input-apple w-full ${errors.service_date ? 'border-danger' : ''}`}
                      required
                    />
                    {errors.service_date && (
                      <p className="text-apple-caption text-danger mt-1">{errors.service_date}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 卡片 1：客戶基本資料 */}
            <div className="card-apple border border-border-light">
              <div className="p-6">
                <h4 className="text-apple-heading text-text-primary mb-4">客戶基本資料</h4>

                <div className="space-y-4">
                  {/* 第一行：服務類型 + 項目分類 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 服務類型 */}
                    <div>
                      <label className="block text-apple-caption font-medium text-text-primary mb-2">
                        服務類型 <span className="text-danger">*</span>
                      </label>
                      <select
                        value={formData.service_type}
                        onChange={(e) => updateField('service_type', e.target.value)}
                        className={`form-input-apple w-full ${errors.service_type ? 'border-danger' : ''}`}
                        required
                      >
                        <option value="">請選擇服務類型</option>
                        {SERVICE_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {errors.service_type && (
                        <p className="text-apple-caption text-danger mt-1">{errors.service_type}</p>
                      )}
                    </div>

                    {/* 項目分類 */}
                    <div>
                      <label className="block text-apple-caption font-medium text-text-primary mb-2">
                        項目分類 <span className="text-danger">*</span>
                      </label>
                      <select
                        value={formData.project_category}
                        onChange={(e) => updateField('project_category', e.target.value)}
                        className={`form-input-apple w-full ${errors.project_category ? 'border-danger' : ''}`}
                        required
                      >
                        <option value="">請選擇項目分類</option>
                        {PROJECT_CATEGORY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {errors.project_category && (
                        <p className="text-apple-caption text-danger mt-1">{errors.project_category}</p>
                      )}
                    </div>
                  </div>

                  {/* 第二行：項目負責人 */}
                  <div>
                    <label className="block text-apple-caption font-medium text-text-primary mb-2">
                      項目負責人 <span className="text-danger">*</span>
                    </label>
                    <select
                      value={formData.project_manager}
                      onChange={(e) => updateField('project_manager', e.target.value)}
                      className={`form-input-apple w-full ${errors.project_manager ? 'border-danger' : ''}`}
                      required
                    >
                      <option value="">請選擇項目負責人</option>
                      {PROJECT_MANAGER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {errors.project_manager && (
                      <p className="text-apple-caption text-danger mt-1">{errors.project_manager}</p>
                    )}
                  </div>

                  {/* 第三行：客戶姓名（含搜尋） + 客戶編號 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 客戶姓名（含搜尋功能） */}
                    <div className="relative customer-search-container">
                      <label className="block text-apple-caption font-medium text-text-primary mb-2">
                        客戶姓名 <span className="text-danger">*</span>
                      </label>

                      <input
                        type="text"
                        value={customerSearchTerm}
                        onChange={(e) => {
                          const value = e.target.value
                          console.log('客戶搜尋輸入變化:', value) // 調試日誌
                          setCustomerSearchTerm(value)
                          updateField('customer_name', value) // 同步更新表單數據

                          // 清除之前的搜尋定時器
                          if (customerSearchTimeout) {
                            clearTimeout(customerSearchTimeout)
                          }

                          if (value.length >= 1) {
                            console.log('設置客戶搜尋定時器') // 調試日誌
                            // 設置新的搜尋定時器（300ms 防抖）
                            const timeout = setTimeout(() => {
                              console.log('執行客戶搜尋') // 調試日誌
                              handleFormCustomerSearch(value)
                            }, 300)
                            setCustomerSearchTimeout(timeout)
                          } else {
                            setShowCustomerSuggestions(false)
                          }
                        }}
                        onFocus={() => {
                          console.log('客戶輸入框獲得焦點') // 調試日誌
                          // 聚焦時如果有搜尋詞且有結果，顯示建議
                          if (customerSearchTerm.length >= 1 && customerSuggestions.length > 0) {
                            setShowCustomerSuggestions(true)
                          }
                        }}
                        className={`form-input-apple w-full ${errors.customer_name ? 'border-danger' : ''}`}
                        placeholder="請輸入客戶姓名或編號（≥1字元）"
                        autoComplete="off"
                        required
                      />

                      {/* 客戶搜尋建議 */}
                      {showCustomerSuggestions && customerSuggestions.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-bg-primary border border-border-light rounded-xl shadow-lg max-h-48 overflow-y-auto">
                          {customerSuggestions.map((customer: CustomerSearchResult, index: number) => (
                            <div
                              key={customer.customer_id || index}
                              onClick={() => selectCustomer(customer)}
                              className="px-4 py-2 hover:bg-bg-secondary cursor-pointer border-b border-border-light last:border-b-0"
                            >
                              <div className="font-medium text-text-primary">
                                {customer.customer_name || customer.display_text}
                                {customer.customer_id && (
                                  <span className="text-text-secondary ml-1">（{customer.customer_id}）</span>
                                )}
                              </div>
                              {customer.phone && (
                                <div className="text-sm text-text-secondary">{customer.phone}</div>
                              )}
                              {customer.service_address && (
                                <div className="text-sm text-text-secondary truncate">{customer.service_address}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {errors.customer_name && (
                        <p className="text-apple-caption text-danger mt-1">{errors.customer_name}</p>
                      )}
                    </div>

                    {/* 客戶編號 */}
                    <div>
                      <label className="block text-apple-caption font-medium text-text-primary mb-2">
                        客戶編號
                      </label>
                      <input
                        type="text"
                        value={formData.customer_id || ''}
                        readOnly
                        className="form-input-apple w-full bg-bg-secondary text-text-secondary cursor-not-allowed"
                        placeholder="選擇客戶後自動填入"
                      />
                    </div>
                  </div>

                  {/* 第四行：聯絡電話 + 服務地址 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 聯絡電話（唯讀） */}
                    <div>
                      <label className="block text-apple-caption font-medium text-text-primary mb-2">
                        聯絡電話
                      </label>
                      <input
                        type="tel"
                        value={formData.phone}
                        readOnly
                        className="form-input-apple w-full bg-bg-secondary text-text-secondary cursor-not-allowed"
                        placeholder="選擇客戶後自動填入"
                      />
                    </div>

                    {/* 服務地址（獨立一行，可編輯） */}
                    <div>
                      <label className="block text-apple-caption font-medium text-text-primary mb-2">
                        服務地址
                      </label>
                      <input
                        type="text"
                        value={formData.service_address}
                        onChange={(e) => updateField('service_address', e.target.value)}
                        className={`form-input-apple w-full ${errors.service_address ? 'border-danger' : ''}`}
                        placeholder="請輸入服務地址"
                      />
                      {errors.service_address && (
                        <p className="text-apple-caption text-danger mt-1">{errors.service_address}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 卡片 2：服務詳情 */}
            <div className="card-apple border border-border-light">
              <div className="p-6">
                <h4 className="text-apple-heading text-text-primary mb-4">服務詳情</h4>

                <div className="space-y-4">
                  {/* 第一行：護理人員搜尋（獨立一行） */}
                  <div className="relative staff-search-container">
                    <label className="block text-apple-caption font-medium text-text-primary mb-2">
                      護理人員
                    </label>
                    <input
                      type="text"
                      value={staffSearchTerm}
                      onChange={(e) => {
                        const value = e.target.value
                        console.log('護理人員搜尋輸入變化:', value) // 調試日誌
                        setStaffSearchTerm(value)
                        updateField('care_staff_name', value) // 同步更新表單數據

                        // 清除之前的搜尋定時器
                        if (staffSearchTimeout) {
                          clearTimeout(staffSearchTimeout)
                        }

                        if (value.length >= 1) {
                          console.log('設置護理人員搜尋定時器') // 調試日誌
                          // 設置新的搜尋定時器（300ms 防抖）
                          const timeout = setTimeout(() => {
                            console.log('執行護理人員搜尋') // 調試日誌
                            handleStaffSearch(value)
                          }, 300)
                          setStaffSearchTimeout(timeout)
                        } else {
                          setShowStaffSuggestions(false)
                        }
                      }}
                      onFocus={() => {
                        console.log('護理人員輸入框獲得焦點') // 調試日誌
                        // 聚焦時如果有搜尋詞且有結果，顯示建議
                        if (staffSearchTerm.length >= 1 && staffSuggestions.length > 0) {
                          setShowStaffSuggestions(true)
                        }
                      }}
                      className={`form-input-apple w-full ${errors.care_staff_name ? 'border-danger' : ''}`}
                      placeholder="輸入護理人員中文姓名或編號（≥1字元）"
                      autoComplete="off"
                    />

                    {/* 護理人員搜尋建議 */}
                    {showStaffSuggestions && staffSuggestions && staffSuggestions.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-bg-primary border border-border-light rounded-xl shadow-lg max-h-48 overflow-y-auto">
                        {staffSuggestions.map((staff, index) => (
                          <div
                            key={staff.staff_id || index}
                            onClick={() => selectStaff(staff)}
                            className="px-4 py-2 hover:bg-bg-secondary cursor-pointer border-b border-border-light last:border-b-0"
                          >
                            <div className="font-medium text-text-primary">
                              {staff.name_chinese}
                              {staff.staff_id && (
                                <span className="text-text-secondary ml-1">（{staff.staff_id}）</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {errors.care_staff_name && (
                      <p className="text-apple-caption text-danger mt-1">{errors.care_staff_name}</p>
                    )}

                    {/* 客戶歷史護理人員提示 */}
                    {formData.customer_name && !formData.staff_id && (
                      <div className="mt-3 bg-green-50 border border-green-200 rounded-xl p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-lg">👥</span>
                          <span className="text-sm font-medium text-green-800">
                            {formData.customer_name} 的最近護理人員
                          </span>
                        </div>
                        {customerStaffHistoryLoading ? (
                          <div className="text-sm text-green-600 animate-pulse">載入中...</div>
                        ) : customerStaffHistory.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {customerStaffHistory.map((staff, index) => (
                              <button
                                key={staff.staff_id}
                                type="button"
                                onClick={() => {
                                  updateField('care_staff_name', staff.care_staff_name)
                                  updateField('staff_id', staff.staff_id)
                                  setStaffSearchTerm(staff.care_staff_name)
                                  loadStaffSalaryHistory(staff.staff_id)
                                }}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-green-300 rounded-lg text-sm text-green-700 hover:bg-green-100 hover:border-green-400 transition-colors"
                              >
                                <span className="font-medium">{staff.care_staff_name}</span>
                                <span className="text-green-500 text-xs">({staff.staff_id})</span>
                                <span className="text-green-400 text-xs ml-1">×{staff.service_count}</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-green-600">暫無歷史記錄</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 護理人員編號（自動帶入） */}
                  <div>
                    <label className="block text-apple-caption font-medium text-text-primary mb-2">
                      護理人員編號 <span className="text-text-secondary">（自動帶入）</span>
                    </label>
                    <input
                      type="text"
                      value={formData.staff_id || ''}
                      readOnly
                      className={`form-input-apple w-full bg-bg-secondary text-text-secondary cursor-not-allowed ${errors.staff_id ? 'border-danger' : ''}`}
                      placeholder="選擇護理人員後自動填入"
                    />
                    {errors.staff_id && (
                      <p className="text-apple-caption text-danger mt-1">{errors.staff_id}</p>
                    )}
                  </div>

                  {/* 第二行：開始時間 + 結束時間 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 開始時間 */}
                    <div>
                      <label className="block text-apple-caption font-medium text-text-primary mb-2">
                        開始時間
                      </label>
                      <input
                        type="time"
                        value={formData.start_time}
                        onChange={(e) => updateField('start_time', e.target.value)}
                        className="form-input-apple w-full"
                        step="1800"
                      />
                    </div>

                    {/* 結束時間 */}
                    <div>
                      <label className="block text-apple-caption font-medium text-text-primary mb-2">
                        結束時間
                      </label>
                      <input
                        type="time"
                        value={formData.end_time}
                        onChange={(e) => updateField('end_time', e.target.value)}
                        className={`form-input-apple w-full ${errors.end_time ? 'border-danger' : ''}`}
                        step="1800"
                      />
                      {errors.end_time && (
                        <p className="text-apple-caption text-danger mt-1">{errors.end_time}</p>
                      )}
                    </div>
                  </div>

                  {/* 第三行：服務時數（自動計算，獨立一行） */}
                  <div>
                    <label className="block text-apple-caption font-medium text-text-primary mb-2">
                      服務時數 <span className="text-danger">*</span>
                    </label>
                    <input
                      type="number"
                      value={formData.service_hours === 0 ? '0' : formData.service_hours || ''}
                      onChange={(e) => updateField('service_hours', e.target.value === '' ? null : parseFloat(e.target.value))}
                      onBlur={(e) => { if (e.target.value === '') updateField('service_hours', 0); }}
                      className={`form-input-apple w-full ${errors.service_hours ? 'border-danger' : ''}`}
                      placeholder="請輸入服務時數"
                      step="0.5"
                      min="0"
                    />
                    {errors.service_hours && (
                      <p className="text-apple-caption text-danger mt-1">{errors.service_hours}</p>
                    )}
                    <p className="text-apple-caption text-text-secondary mt-1">
                      填入開始/結束時間後會自動計算，也可手動輸入
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 卡片 3：收費與工資 */}
            <div className="card-apple border border-border-light">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-apple-heading text-text-primary">收費與工資</h4>
                  <button
                    type="button"
                    onClick={() => setShowCalculator(!showCalculator)}
                    className={`p-2 rounded-lg transition-colors ${
                      showCalculator 
                        ? 'bg-primary text-white' 
                        : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary'
                    }`}
                    title="計算機"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>

                {/* 計算機 UI */}
                {showCalculator && (
                  <div className="mb-4 bg-gray-800 rounded-xl p-4 shadow-lg">
                    {/* 顯示屏 */}
                    <div className="bg-gray-900 rounded-lg p-3 mb-3">
                      <div className="text-right text-2xl font-mono text-white truncate">
                        {calcDisplay}
                      </div>
                      {calcOperation && (
                        <div className="text-right text-xs text-gray-400 mt-1">
                          {calcPrevValue} {calcOperation}
                        </div>
                      )}
                    </div>
                    {/* 按鈕區 */}
                    <div className="grid grid-cols-4 gap-2">
                      <button type="button" onClick={calcClear} className="col-span-2 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors">C</button>
                      <button type="button" onClick={() => calcPerformOperation('÷')} className="py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition-colors">÷</button>
                      <button type="button" onClick={() => calcPerformOperation('×')} className="py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition-colors">×</button>
                      
                      <button type="button" onClick={() => calcInputDigit('7')} className="py-3 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-medium transition-colors">7</button>
                      <button type="button" onClick={() => calcInputDigit('8')} className="py-3 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-medium transition-colors">8</button>
                      <button type="button" onClick={() => calcInputDigit('9')} className="py-3 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-medium transition-colors">9</button>
                      <button type="button" onClick={() => calcPerformOperation('-')} className="py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition-colors">-</button>
                      
                      <button type="button" onClick={() => calcInputDigit('4')} className="py-3 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-medium transition-colors">4</button>
                      <button type="button" onClick={() => calcInputDigit('5')} className="py-3 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-medium transition-colors">5</button>
                      <button type="button" onClick={() => calcInputDigit('6')} className="py-3 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-medium transition-colors">6</button>
                      <button type="button" onClick={() => calcPerformOperation('+')} className="py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition-colors">+</button>
                      
                      <button type="button" onClick={() => calcInputDigit('1')} className="py-3 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-medium transition-colors">1</button>
                      <button type="button" onClick={() => calcInputDigit('2')} className="py-3 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-medium transition-colors">2</button>
                      <button type="button" onClick={() => calcInputDigit('3')} className="py-3 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-medium transition-colors">3</button>
                      <button type="button" onClick={calcEquals} className="row-span-2 py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors">=</button>
                      
                      <button type="button" onClick={() => calcInputDigit('0')} className="col-span-2 py-3 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-medium transition-colors">0</button>
                      <button type="button" onClick={calcInputDot} className="py-3 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-medium transition-colors">.</button>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  {/* 護理人員薪資歷史記錄提示 */}
                  {formData.staff_id && (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">📋</span>
                        <span className="text-sm font-medium text-blue-800">
                          最近 5 次記錄 ({formData.staff_id} {formData.care_staff_name})
                        </span>
                      </div>
                      {staffSalaryHistoryLoading ? (
                        <div className="text-sm text-blue-600 animate-pulse">載入中...</div>
                      ) : staffSalaryHistory.length > 0 ? (
                        <div className="space-y-1">
                          {staffSalaryHistory.map((record, index) => (
                            <div key={index} className="text-sm text-blue-700 font-mono bg-white/50 px-2 py-1 rounded">
                              <span className="inline-block w-4 text-blue-500">{'①②③④⑤'[index]}</span>
                              {' '}{record.service_date} | {record.customer_name || '未知客戶'} | 薪資: ${record.staff_salary?.toLocaleString() || 0} | 時薪: ${record.hourly_salary?.toLocaleString() || 0}/小時
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-blue-600">暫無歷史記錄</div>
                      )}
                    </div>
                  )}
                  {/* 第一行：服務費用 + 員工薪資 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 服務費用 */}
                    <div>
                      <label className="block text-apple-caption font-medium text-text-primary mb-2">
                        服務費用 <span className="text-danger">*</span>
                      </label>
                      <input
                        type="number"
                        value={formData.service_fee === 0 ? '0' : formData.service_fee || ''}
                        onChange={(e) => updateField('service_fee', e.target.value === '' ? null : parseFloat(e.target.value))}
                        onBlur={(e) => { if (e.target.value === '') updateField('service_fee', 0); }}
                        className={`form-input-apple w-full ${errors.service_fee ? 'border-danger' : ''}`}
                        placeholder="請輸入服務費用"
                        min="0"
                        step="0.01"
                      />
                      {errors.service_fee && (
                        <p className="text-apple-caption text-danger mt-1">{errors.service_fee}</p>
                      )}
                    </div>

                    {/* 員工薪資 */}
                    <div>
                      <label className="block text-apple-caption font-medium text-text-primary mb-2">
                        員工薪資 <span className="text-danger">*</span>
                      </label>
                      <input
                        type="number"
                        value={formData.staff_salary === 0 ? '0' : formData.staff_salary || ''}
                        onChange={(e) => updateField('staff_salary', e.target.value === '' ? null : parseFloat(e.target.value))}
                        onBlur={(e) => { if (e.target.value === '') updateField('staff_salary', 0); }}
                        className={`form-input-apple w-full ${errors.staff_salary ? 'border-danger' : ''}`}
                        placeholder="請輸入員工薪資"
                        min="0"
                        step="0.01"
                      />
                      {errors.staff_salary && (
                        <p className="text-apple-caption text-danger mt-1">{errors.staff_salary}</p>
                      )}
                      <p className="text-apple-caption text-text-secondary mt-1">
                        員工薪資不能超過服務費用
                      </p>
                    </div>
                  </div>

                  {/* 第二行：每小時收費 + 每小時薪資 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 每小時收費（自動計算） */}
                    <div>
                      <label className="block text-apple-caption font-medium text-text-primary mb-2">
                        每小時收費
                      </label>
                      <input
                        type="number"
                        value={formData.hourly_rate.toFixed(2)}
                        readOnly
                        className="form-input-apple w-full bg-bg-secondary text-text-secondary cursor-not-allowed"
                        placeholder="自動計算"
                      />
                      <p className="text-apple-caption text-text-secondary mt-1">
                        自動計算：服務費用 ÷ 服務時數
                      </p>
                    </div>

                    {/* 每小時薪資（自動計算） */}
                    <div>
                      <label className="block text-apple-caption font-medium text-text-primary mb-2">
                        每小時薪資
                      </label>
                      <input
                        type="number"
                        value={formData.hourly_salary.toFixed(2)}
                        readOnly
                        className="form-input-apple w-full bg-bg-secondary text-text-secondary cursor-not-allowed"
                        placeholder="自動計算"
                      />
                      <p className="text-apple-caption text-text-secondary mt-1">
                        自動計算：員工薪資 ÷ 服務時數
                      </p>
                    </div>
                  </div>

                  {/* 第三行：本次利潤（突出顯示） */}
                  <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                    <div className="flex justify-between items-center">
                      <label className="text-apple-body font-medium text-green-800">
                        本次利潤
                      </label>
                      <div className="text-apple-heading font-bold text-green-700">
                        ${((formData.service_fee || 0) - (formData.staff_salary || 0)).toFixed(2)}
                      </div>
                    </div>
                    <p className="text-apple-caption text-green-600 mt-1">
                      計算公式：服務費用 - 員工薪資
                    </p>
                  </div>

                  {/* 費用摘要（額外資訊） */}
                  <div className="border-t border-border-light pt-4">
                    <h5 className="text-apple-body font-medium text-text-primary mb-2">費用摘要</h5>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div className="text-center">
                        <div className="text-text-secondary">服務費用</div>
                        <div className="font-medium text-text-primary">${(formData.service_fee || 0).toFixed(2)}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-text-secondary">員工薪資</div>
                        <div className="font-medium text-text-primary">${(formData.staff_salary || 0).toFixed(2)}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-text-secondary">利潤率</div>
                        <div className="font-medium text-text-primary">
                          {(formData.service_fee || 0) > 0 ?
                            `${((((formData.service_fee || 0) - (formData.staff_salary || 0)) / (formData.service_fee || 1)) * 100).toFixed(1)}%` :
                            '0%'
                          }
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-text-secondary">服務時數</div>
                        <div className="font-medium text-text-primary">{formData.service_hours}小時</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border-light bg-bg-secondary">
          <div className="flex justify-between">
            {/* 左側 - 刪除按鈕（只在編輯模式顯示） */}
            <div>
              {existingRecord && onDelete && (
                <button
                  type="button"
                  onClick={async () => {
                    if (confirm('確定要刪除這筆記錄嗎？此操作無法復原。')) {
                      try {
                        await onDelete(existingRecord.id)
                        onClose()
                      } catch (error) {
                        console.error('刪除失敗:', error)
                        alert('刪除失敗，請稍後再試')
                      }
                    }
                  }}
                  disabled={submitting}
                  className="px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-all duration-300 disabled:opacity-50"
                >
                  {submitting ? '刪除中...' : '刪除'}
                </button>
              )}
            </div>

            {/* 右側 - 取消和確認按鈕 */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-text-secondary border border-border-light rounded-xl hover:bg-bg-primary transition-all duration-300"
                disabled={submitting}
              >
                取消
              </button>
              <button
                type="submit"
                onClick={handleSubmit}
                disabled={submitting}
                className="px-4 py-2 bg-primary text-white rounded-xl hover:bg-opacity-90 transition-all duration-300 disabled:opacity-50"
              >
                {submitting ? '處理中...' : existingRecord ? '儲存修改' : (isMultipleDays ? '批量新增' : '新增排班')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// 本地排程編輯模態框
interface LocalScheduleEditModalProps {
  isOpen: boolean
  schedule: BillingSalaryFormData | null
  onClose: () => void
  onUpdate: (formData: BillingSalaryFormData) => void
  onDelete: () => void
  onEdit: () => void
}

function LocalScheduleEditModal({
  isOpen,
  schedule,
  onClose,
  onUpdate,
  onDelete,
  onEdit
}: LocalScheduleEditModalProps) {
  if (!isOpen || !schedule) return null

  return (
    <div className="fixed inset-0 bg-black/50 z-[9999]" onClick={onClose}>
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg-primary rounded-xl w-[calc(100%-2rem)] max-w-md max-h-[90vh] overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="p-6 border-b border-border-light">
          <h3 className="text-lg font-medium text-text-primary">
            排程選項
          </h3>
          <p className="text-sm text-text-secondary mt-1">
            選擇要對此排程執行的操作
          </p>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* 排程詳情 */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
            <div className="text-sm text-text-secondary mb-2">
              <strong>日期：</strong> {schedule.service_date}
            </div>
            <div className="text-sm text-text-secondary mb-2">
              <strong>客戶：</strong> {schedule.customer_name}
            </div>
            <div className="text-sm text-text-secondary mb-2">
              <strong>護理人員：</strong> {schedule.care_staff_name}
            </div>
            <div className="text-sm text-text-secondary mb-2">
              <strong>護理員編號：</strong> {schedule.staff_id || '—'}
            </div>
            <div className="text-sm text-text-secondary mb-2">
              <strong>服務類型：</strong> {schedule.service_type}
            </div>
            <div className="text-sm text-text-secondary">
              <strong>時間：</strong> {schedule.start_time} - {schedule.end_time}
            </div>
          </div>

          {/* 操作按鈕 */}
          <div className="space-y-3">
            <button
              onClick={onEdit}
              className="w-full px-4 py-3 bg-blue-500 text-white rounded-xl hover:bg-primary-dark transition-colors text-left"
            >
              <div className="flex items-center">
                <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                編輯排程
              </div>
            </button>

            <button
              onClick={() => {
                if (confirm('確定要刪除這個排程嗎？')) {
                  onDelete()
                }
              }}
              className="w-full px-4 py-3 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors text-left"
            >
              <div className="flex items-center">
                <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                刪除排程
              </div>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border-light bg-bg-secondary">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-text-secondary border border-border-light rounded-xl hover:bg-bg-primary transition-all duration-300"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
