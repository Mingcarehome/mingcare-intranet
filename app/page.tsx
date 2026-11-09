'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { supabase } from '../lib/supabase'
import { getAssetPath } from '../utils/asset-path'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  // 載入儲存的電子郵件，並移除舊版儲存的密碼
  useEffect(() => {
    localStorage.removeItem('mingcare_password')
    const savedEmail = localStorage.getItem('mingcare_email')
    const savedRememberMe = localStorage.getItem('mingcare_remember') === 'true'
    
    if (savedEmail && savedRememberMe) {
      setEmail(savedEmail)
      setRememberMe(savedRememberMe)
    }
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
      })

      if (error) throw error

      if (data.user) {
        // 只儲存電子郵件偏好（如果用戶選擇記住）
        if (rememberMe) {
          localStorage.setItem('mingcare_email', email)
          localStorage.setItem('mingcare_remember', 'true')
        } else {
          // 清除儲存的登入信息
          localStorage.removeItem('mingcare_email')
          localStorage.removeItem('mingcare_password')
          localStorage.removeItem('mingcare_remember')
        }
        
        router.push('/dashboard')
      }
    } catch (error: any) {
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-primary py-6 sm:py-12 px-3 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        <div className="card-apple fade-in-apple">
          <div className="card-apple-content p-4 sm:p-6 lg:p-8">
            <div className="text-center mb-6 sm:mb-8">
              <div className="mx-auto flex items-center justify-center mb-2 sm:mb-3 overflow-visible">
                <div className="w-48 h-48 sm:w-56 sm:h-56 lg:w-64 lg:h-64 -my-8 sm:-my-10 lg:-my-12">
                  <Image 
                    src={getAssetPath("images/mingcare-logo.png")}
                    alt="MingCare Logo" 
                    width={1024}
                    height={1024}
                    priority
                    quality={100}
                    unoptimized
                    className="w-full h-full object-contain"
                    style={{ imageRendering: 'crisp-edges' }}
                  />
                </div>
              </div>
              <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-text-primary mb-1 sm:mb-2">
                明家居家護理服務
              </h2>
              <p className="text-sm sm:text-base text-text-secondary">
                明家內聯網系統
              </p>
            </div>
            
            <form className="space-y-4 sm:space-y-6" onSubmit={handleLogin}>
              <div className="space-y-3 sm:space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm sm:text-base font-medium text-text-primary mb-1 sm:mb-2">
                    電子郵件
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    className="form-input-apple text-sm sm:text-base h-11 sm:h-12"
                    placeholder="請輸入您的電子郵件"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="password" className="block text-sm sm:text-base font-medium text-text-primary mb-1 sm:mb-2">
                    密碼
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    className="form-input-apple text-sm sm:text-base h-11 sm:h-12"
                    placeholder="請輸入您的密碼"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              {/* 記住我選項 */}
              <div className="flex items-center justify-between">
                <label className="flex items-center space-x-2 sm:space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="checkbox-apple w-4 h-4 sm:w-5 sm:h-5"
                  />
                  <span className="text-xs sm:text-sm text-text-secondary select-none">記住我</span>
                </label>
                <a href="#" className="text-xs sm:text-sm text-primary hover:text-primary-dark transition-colors duration-150">
                  忘記密碼？
                </a>
              </div>

              {error && (
                <div className="p-3 sm:p-4 bg-danger-light border border-danger rounded-apple-sm">
                  <p className="text-xs sm:text-sm text-danger font-medium">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full btn-apple-primary py-2.5 sm:py-3 text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <div className="flex items-center justify-center">
                    <div className="inline-block animate-spin rounded-full h-3 w-3 sm:h-4 sm:w-4 border-2 border-white border-t-transparent mr-2"></div>
                    登入中...
                  </div>
                ) : (
                  '登入'
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
