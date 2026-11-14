// Employee columns every member may read (mirrors the column grant in
// migration 0053). Private HR fields — pay, bank, ID, personal — are loaded
// separately through the employee_private() RPC for authorised users only.
export const EMP_PUBLIC_COLUMNS = [
  'id', 'org_id', 'employee_no', 'full_name', 'department', 'position', 'status', 'worker_type',
  'email', 'phone', 'hired_on', 'created_at', 'gender', 'nationality',
  'next_of_kin_name', 'next_of_kin_phone', 'next_of_kin_relation',
  'dress_size', 'shoe_size', 'top_size', 'trouser_waist',
  'photo_url', 'notes', 'hours_per_day', 'standard_working_days',
]
export const EMP_PUBLIC_SELECT = EMP_PUBLIC_COLUMNS.join(',')

export const EMP_PRIVATE_KEYS = [
  'home_address', 'postal_address', 'date_of_birth', 'marital_status',
  'spouse_name', 'spouse_phone', 'number_of_kids', 'dependants',
  'id_type', 'id_number', 'ssnit_number', 'tin_number',
  'id_document_type', 'id_document_url', 'contract_url',
  'bank_name', 'bank_branch', 'account_name', 'account_number', 'account_type', 'mobile_money_no',
  'pay_type', 'pay_rate', 'leave_allowance', 'pay_allowances',
  'compliance_note', 'compliance_url',
]

export function stripPrivate(payload) {
  const p = { ...payload }
  EMP_PRIVATE_KEYS.forEach((k) => { delete p[k] })
  return p
}
