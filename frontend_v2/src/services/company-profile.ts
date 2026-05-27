import { api } from "@/lib/api"

export interface CompanyProfile {
    id: number
    legal_name: string
    trading_name: string
    tagline: string
    address_line1: string
    address_line2: string
    city: string
    state: string
    country: string
    pincode: string
    phone_primary: string
    phone_secondary: string
    email: string
    website: string
    gstin: string
    pan: string
    cin: string
    udyam: string
    iec_code: string
    bank_name: string
    bank_branch: string
    bank_account_no: string
    bank_ifsc: string
    bank_upi: string
    default_payment_terms: string
    default_jurisdiction: string
    quote_validity_days: number
    quote_terms_text: string
    authorised_signatory_name: string
    authorised_signatory_role: string
    logo_path: string
    updated_at?: string
    updated_by_username?: string
}

export const companyProfileService = {
    get: async (): Promise<CompanyProfile> => {
        const { data } = await api.get<CompanyProfile>("/api/system/company-profile/")
        return data
    },
    update: async (body: Partial<CompanyProfile>): Promise<CompanyProfile> => {
        const { data } = await api.patch<CompanyProfile>("/api/system/company-profile/", body)
        return data
    },
}
