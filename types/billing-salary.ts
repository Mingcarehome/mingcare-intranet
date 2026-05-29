// 護理服務管理系統類型定義
// 基於 public.billing_salary_data 表結構

// =============================================================================
// 基礎資料類型
// =============================================================================

export interface BillingSalaryRecord {
  id: string
  service_date: string // YYYY-MM-DD
  customer_id: string
  customer_name: string
  phone: string
  service_address: string
  start_time: string // HH:mm
  end_time: string // HH:mm
  service_hours: number
  staff_id: string
  care_staff_name: string
  service_fee: number
  staff_salary: number
  hourly_rate: number
  hourly_salary: number
  service_type: ServiceType
  project_category: ProjectCategory
  project_manager: ProjectManager
  created_at: string
  updated_at: string
  profit?: number // 服務利潤（可選，從 API 返回的計算結果）
}

// 計算欄位（前端顯示用）
export interface BillingSalaryRecordWithCalculated extends BillingSalaryRecord {
  profit: number // service_fee - staff_salary
}

// 跨夜更記錄（用於月曆顯示）
export interface BillingSalaryRecordWithOvernight extends BillingSalaryRecord {
  _isOvernightEndDay?: boolean // 標記此記錄是否為跨夜更的結束日顯示
}

// =============================================================================
// ENUM 類型定義
// =============================================================================

export type ServiceType = 
  | 'ES-護送服務(陪診)'
  | 'HC-家居服務'
  | 'NC-護理服務(專業⼈員)'
  | 'PC-到⼾看顧(輔助⼈員)'
  | 'RA-復康運動(輔助⼈員)'
  | 'RT-復康運動(OTA輔助⼈員)'
  | 'RT-復康運動(專業⼈員)'
  | '上門評估服務'
  | '傷口護理'
  | '免費服務體驗'
  | '社區活動'

export type ProjectCategory = 
  | 'MC社區券(醫點）'
  | 'MC街客'
  | 'Steven140'
  | 'Steven200'
  | 'Steven醫點'
  | '俊佳'
  | '安心同行'

export type ProjectManager = 
  | 'Candy Ho'
  | 'Joe Cheung'
  | 'Kanas Leung'

// =============================================================================
// 篩選和搜尋類型
// =============================================================================

export interface BillingSalaryFilters {
  dateRange: {
    start: string // YYYY-MM-DD
    end: string // YYYY-MM-DD
  }
  serviceType?: ServiceType
  projectCategory?: ProjectCategory | ProjectCategory[]  // 支援單選或複選
  projectManager?: ProjectManager
  careStaffName?: string
  searchTerm?: string // customer_name / phone / customer_id
  selectedCustomerIds?: string[] // 多選客戶的 ID 陣列
}

export interface SearchSuggestion {
  id: string
  type: 'customer_name' | 'phone' | 'customer_id'
  value: string
  display_text: string
}

// =============================================================================
// 表單類型
// =============================================================================

export interface BillingSalaryFormData {
  service_date: string
  customer_id: string
  customer_name: string
  phone: string
  service_address: string
  start_time: string
  end_time: string
  service_hours: number
  staff_id: string
  care_staff_name: string
  service_fee: number
  staff_salary: number
  hourly_rate: number
  hourly_salary: number
  service_type: ServiceType | ''
  project_category: ProjectCategory | ''
  project_manager: ProjectManager | ''
}

// 多天新增表單
export interface MultipleDayFormData extends Omit<BillingSalaryFormData, 'service_date'> {
  dateRange: {
    start: string
    end: string
  }
  repeatPattern: 'daily' | 'weekly'
  weeklyDays?: number[] // 0=Sunday, 1=Monday, etc.
  excludeDates?: string[] // YYYY-MM-DD
}

// =============================================================================
// KPI 和統計類型
// =============================================================================

export interface BusinessKPI {
  totalRevenue: number // Σ service_fee
  totalProfit: number // Σ (service_fee - staff_salary)
  totalServiceHours: number // Σ service_hours
  avgProfitPerHour: number // totalProfit / totalServiceHours
  revenueGrowthRate: number // 與上月對比百分比
}

export interface ProjectCategorySummary {
  category: ProjectCategory
  totalFee: number
  totalHours: number
  totalProfit: number
  recordCount: number
  uniqueCustomers: number // 本月服務客戶數
}

// =============================================================================
// API 回應類型
// =============================================================================

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface BatchOperationResult {
  success: number
  failed: number
  skipped: number
  errors: string[]
  details: {
    date: string
    status: 'success' | 'failed' | 'skipped'
    error?: string
  }[]
}

// =============================================================================
// 月曆相關類型
// =============================================================================

export interface CalendarDay {
  date: string // YYYY-MM-DD
  isCurrentMonth: boolean
  isToday: boolean
  isSelected: boolean
  records: BillingSalaryRecord[]
  totalRevenue: number
  totalHours: number
}

export interface CalendarSelection {
  start: string | null
  end: string | null
  dates: string[]
}

// =============================================================================
// 常數定義
// =============================================================================

export const SERVICE_TYPE_OPTIONS: { value: ServiceType; label: string }[] = [
  { value: 'ES-護送服務(陪診)', label: 'ES-護送服務(陪診)' },
  { value: 'HC-家居服務', label: 'HC-家居服務' },
  { value: 'NC-護理服務(專業⼈員)', label: 'NC-護理服務(專業⼈員)' },
  { value: 'PC-到⼾看顧(輔助⼈員)', label: 'PC-到⼾看顧(輔助⼈員)' },
  { value: 'RA-復康運動(輔助⼈員)', label: 'RA-復康運動(輔助⼈員)' },
  { value: 'RT-復康運動(OTA輔助⼈員)', label: 'RT-復康運動(OTA輔助⼈員)' },
  { value: 'RT-復康運動(專業⼈員)', label: 'RT-復康運動(專業⼈員)' },
  { value: '上門評估服務', label: '上門評估服務' },
  { value: '傷口護理', label: '傷口護理' },
  { value: '免費服務體驗', label: '免費服務體驗' },
  { value: '社區活動', label: '社區活動' }
]

export const PROJECT_CATEGORY_OPTIONS: { value: ProjectCategory; label: string }[] = [
  { value: 'MC社區券(醫點）', label: 'MC社區券(醫點）' },
  { value: 'MC街客', label: 'MC街客' },
  { value: 'Steven140', label: 'Steven140' },
  { value: 'Steven200', label: 'Steven200' },
  { value: 'Steven醫點', label: 'Steven醫點' },
  { value: '俊佳', label: '俊佳' },
  { value: '安心同行', label: '安心同行' }
]

export const PROJECT_MANAGER_OPTIONS: { value: ProjectManager; label: string }[] = [
  { value: 'Candy Ho', label: 'Candy Ho' },
  { value: 'Joe Cheung', label: 'Joe Cheung' },
  { value: 'Kanas Leung', label: 'Kanas Leung' }
]

// =============================================================================
// 日期快捷鍵類型
// =============================================================================

export type DateRangePreset = 
  | 'last7days'
  | 'last30days'
  | 'last90days'
  | 'thisMonth'
  | 'lastMonth'
  | 'last3months'
  | 'last6months'
  | 'thisQuarter'
  | 'thisYear'
  | 'custom'

export interface DateRangePresetOption {
  key: DateRangePreset
  label: string
  getValue: () => { start: string; end: string }
}