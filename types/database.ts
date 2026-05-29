// TypeScript 類型定義 - 基於 Supabase 數據庫結構
// Generated: 2025-08-13

// ========================================================================
// ENUM TYPES（列舉型別）
// ========================================================================

export type ContractStatus = '同意' | '不同意';
export type CopayLevel = '5%' | '8%' | '12%' | '16%' | '25%' | '40%';
export type CovidVaccine = '1針' | '2針' | '3針' | '4針' | '無接種' | 'Other';
export type CustomerType = '社區券客戶' | '明家街客' | '家訪客戶';
export type District =
  | '中西區' | '九龍城區' | '元朗區' | '北區' | '南區' | '大埔區'
  | '屯門區' | '東區' | '沙田區' | '油尖旺區' | '深水埗區' | '灣仔區'
  | '荃灣區' | '葵青區' | '西貢區' | '觀塘區' | '離島區' | '黃大仙區'
  | '未分類（醫院,院舍)';
export type Gender = '男' | '女';
export type HealthStatus = '良好' | '中風' | '需協助' | '長期病患' | '認知障礙';
export type HomeVisitStatus = '已完成' | '未完成';
export type Introducer =
  | 'Kanas Leung' | 'Joe Cheung' | 'Candy Ho' | 'Tracy Yau' | 'Steven Kwok'
  | 'Dr.Lee' | 'Annie' | 'Janet' | '陸sir' | '吳翹政' | '余翠英'
  | '陳小姐MC01' | '曾先生' | '梁曉峰' | 'raymond';
export type LdsStatus = '已完成評估' | '已經持有' | '待社工評估';
export type PreferredArea =
  | '所有區域' | '灣仔區' | '中西區' | '東區' | '南區' | '油尖旺區'
  | '深水埗區' | '九龍城區' | '黃大仙區' | '觀塘區' | '西貢區' | '沙田區'
  | '大埔區' | '北區' | '荃灣區' | '屯門區' | '元朗區' | '葵青區' | '離島區';
export type ProjectCategory = 'MC社區券(醫點）' | 'MC街客' | 'Steven140' | 'Steven200' | 'Steven醫點' | '俊佳' | '安心同行';
export type ProjectManager = 'Candy Ho' | 'Joe Cheung' | 'Kanas Leung' | 'Tracy Yau';
export type ServiceType =
  | 'ES-護送服務(陪診)' | 'FD-送飯服務' | 'HC-家居服務' | 'NA-護理服務（輔助人員）'
  | 'NC-護理服務(專業⼈員)' | 'PC-到⼾看顧(輔助⼈員)' | 'RA-復康運動(輔助⼈員)' | 'RT-復康運動(OTA輔助⼈員)'
  | 'RT-復康運動(專業⼈員)' | '上門評估服務' | '傷口護理' | '免費服務體驗'
  | '外傭培訓服務' | '新員工培訓課師' | '社區活動' | '認知障礙訓練'
  | '介紹人獎金(一)' | '介紹人獎金(二)' | '介紹人獎金(三)' | '介紹人獎金(四)';
export type VoucherApplicationStatus = '已經持有' | '申請中';
export type StaffOwner = 'Kanas Leung' | 'Joe Cheung' | 'Candy Ho' | 'Tracy Yau';

// ========================================================================
// TABLE TYPES（資料表型別）
// ========================================================================

// 收費工資資料表
export interface BillingSalaryData {
  id: string;
  service_date?: string;
  customer_id?: string;
  customer_name?: string;
  phone?: string;
  service_address?: string;
  start_time?: string;
  end_time?: string;
  service_hours?: number;
  care_staff_name?: string;
  service_fee?: number;
  staff_salary?: number;
  hourly_rate?: number;
  hourly_salary?: number;
  service_type?: ServiceType;
  project_category?: ProjectCategory;
  project_manager?: ProjectManager;
  created_at?: string;
  updated_at?: string;
}

// 護理人員資料表
export interface CareStaffProfile {
  id: string;
  staff_id?: string;
  name_chinese?: string;
  name_english?: string;
  phone?: string;
  email?: string;
  hkid?: string;
  dob?: string;
  gender?: Gender;
  nationality?: string;
  address?: string;
  preferred_area?: PreferredArea;
  emergency_contact?: string;
  emergency_contact_phone?: string;
  language?: string[];
  job_position?: string[];
  experience_years?: string;
  covid_vaccine?: CovidVaccine;
  referrer?: string;
  referrer_phone?: string;
  company_name?: string;
  company_position?: string;
  employment_period?: string;
  main_duties?: string;
  profile_photo_url?: string;
  hkid_copy_url?: string;
  certificate_1?: string;
  certificate_2?: string;
  certificate_3?: string;
  certificate_4?: string;
  certificate_5?: string;
  scrc_status?: string;
  contract_status?: ContractStatus;
  created_at?: string;
}

// 客戶個人資料表
export interface CustomerPersonalData {
  id: string;
  customer_id?: string;
  customer_type: CustomerType;
  voucher_number?: string;
  charity_support?: boolean;
  customer_name: string;
  phone?: string;
  district?: District;
  service_address: string;
  hkid?: string;
  dob?: string;
  age?: number;
  health_status?: HealthStatus;
  created_at?: string;
  introducer?: Introducer;
  voucher_application_status?: VoucherApplicationStatus;
  lds_status?: LdsStatus;
  home_visit_status?: HomeVisitStatus;
  project_manager?: StaffOwner;
  copay_level?: CopayLevel;
}

// 職位選項表
export interface JobPositionOption {
  id: number;
  label: string;
}

// 語言選項表
export interface LanguageOption {
  id: number;
  label: string;
}

// ========================================================================
// FORM TYPES（表單型別）
// ========================================================================

// 新增/編輯客戶表單
export interface CustomerFormData {
  customer_type: CustomerType;
  voucher_number?: string;
  charity_support?: boolean;
  customer_name: string;
  phone?: string;
  district?: District;
  service_address: string;
  hkid?: string;
  dob?: string;
  age?: number;
  health_status?: HealthStatus;
  introducer?: Introducer;
  voucher_application_status?: VoucherApplicationStatus;
  lds_status?: LdsStatus;
  home_visit_status?: HomeVisitStatus;
  staff_owner?: StaffOwner;
  copay_level?: CopayLevel;
  location_latitude?: number;
  location_longitude?: number;
}

// 新增/編輯護理人員表單
export interface CareStaffFormData {
  name_chinese?: string;
  name_english?: string;
  phone?: string;
  email?: string;
  hkid?: string;
  dob?: string;
  gender?: Gender;
  nationality?: string;
  preferred_area?: PreferredArea;
  emergency_contact?: string;
  emergency_contact_phone?: string;
  language?: string[];
  job_position?: string[];
  experience_years?: string;
  covid_vaccine?: CovidVaccine;
  referrer?: string;
  referrer_phone?: string;
  company_name?: string;
  company_position?: string;
  employment_period?: string;
  main_duties?: string;
  contract_status?: ContractStatus;
}

// 新增/編輯服務記錄表單
export interface ServiceFormData {
  service_date?: string;
  customer_id?: string;
  customer_name?: string;
  phone?: string;
  service_address?: string;
  start_time?: string;
  end_time?: string;
  service_hours?: number;
  care_staff_name?: string;
  service_fee?: number;
  staff_salary?: number;
  hourly_rate?: number;
  hourly_salary?: number;
  service_type?: ServiceType;
  project_category?: ProjectCategory;
  project_manager?: ProjectManager;
}

// ========================================================================
// API RESPONSE TYPES（API 回應型別）
// ========================================================================

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  count?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ========================================================================
// FILTER & SEARCH TYPES（篩選和搜尋型別）
// ========================================================================

export interface CustomerFilters {
  customer_type?: CustomerType;
  district?: District;
  health_status?: HealthStatus;
  project_manager?: StaffOwner;
  introducer?: Introducer;
  search?: string;
}

export interface StaffFilters {
  gender?: Gender;
  preferred_area?: PreferredArea;
  contract_status?: ContractStatus;
  job_position?: string;
  search?: string;
}

export interface ServiceFilters {
  service_type?: ServiceType;
  project_category?: ProjectCategory;
  project_manager?: ProjectManager;
  date_from?: string;
  date_to?: string;
  search?: string;
}

// ========================================================================
// STATISTICS TYPES（統計型別）
// ========================================================================

export interface DashboardStats {
  totalCustomers: number;
  totalStaff: number;
  totalServices: number;
  monthlyRevenue: number;
  activeServices: number;
}

export interface PayrollStats {
  totalSalary: number;
  staffCount: number;
  averageHourlyRate: number;
  totalHours: number;
}

export interface CommissionStats {
  totalCommission: number;
  totalRevenue: number;
  commissionRate: number;
  topPerformers: Array<{
    name: string;
    commission: number;
    revenue: number;
  }>;
}
