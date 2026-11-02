// Single source of truth for the dummy database structure.
//
// Only the columns AIRA's SQL actually reads are created. Patient columns are never created,
// so "patient data stays aggregate-only" holds by construction: a query that tried to read one
// would fail instead of leaking. Generators build rows in the order of `columns` below.

export interface TableDef {
  /** Fully qualified, quoted where needed: public."SalesRepository" */
  name: string
  columns: readonly (readonly [string, string])[]
}

export const PATIENT_COLUMNS = [
  'patient_name',
  'dob',
  'clin_diagnosis',
  'pa_diagnosis',
  'result',
  'gender',
  'patient'
] as const

const T = 'text'
const TS = 'timestamp'
const D = 'date'
const NUM = 'numeric(18,2)'
const INT = 'integer'
const BIG = 'bigint'
const BOOL = 'boolean'
/** Master Data came from MariaDB, where flags are TINYINT 0/1 — the app compares them as 1 / '1'. */
const FLAG = 'smallint'

export const SALES_REPOSITORY: TableDef = {
  name: 'public."SalesRepository"',
  columns: [
    ['id', `${BIG} PRIMARY KEY`],
    ['invoice_no', T],
    ['order_id', T],
    ['date_received', D],
    ['date_result', D],
    ['customer_id', T],
    ['customer_name', T],
    ['item_code', T],
    ['test', T],
    ['source', T],
    ['qty', INT],
    ['gross_sales', NUM],
    ['discount', NUM],
    ['nett_sales', NUM],
    ['month', INT],
    ['year', INT],
    ['clinician', T],
    ['payer_name', T],
    ['payer_type', T],
    ['payment_method', T],
    ['price_type', T],
    ['kd_cabang', T],
    ['city', T],
    ['transfer_test_deleted_at', TS],
    ['transaction_transfer_deleted_at', TS],
    ['bridging_status_to', T],
    ['bridging_status_result', T],
    ['created_at', `${TS} DEFAULT now()`],
    ['updated_at', TS]
  ]
}

export const M_CUSTOMER: TableDef = {
  name: 'public.m_customer',
  columns: [
    ['id', `${INT} PRIMARY KEY`],
    ['customer_code_lis', T],
    ['customer_name', T],
    ['customer_type', T],
    ['customer_city', T],
    ['customer_province', T],
    ['is_active', BOOL]
  ]
}

/** region.ts joins m_customer.customer_province -> province_id, customer_city -> city_id. */
export const M_PROVINCES: TableDef = {
  name: 'public.m_provinces',
  columns: [
    ['province_id', `${T} PRIMARY KEY`],
    ['description', T]
  ]
}

export const M_CITIES: TableDef = {
  name: 'public.m_cities',
  columns: [
    ['city_id', `${T} PRIMARY KEY`],
    ['province_id', T],
    ['description', T]
  ]
}

export const M_ITEM_REPOSITORY: TableDef = {
  name: 'public.m_item_repository',
  columns: [
    ['id', `${INT} PRIMARY KEY`],
    ['item_code_erp', T],
    ['item_name', T],
    ['status', T]
  ]
}

/** KOLOM_AMAN (src/main/lab/rules.ts) + ETL columns. No `patient`. */
export const SAMPLE_TRACKER: TableDef = {
  name: 'public.t_sample_tracker',
  columns: [
    ['unique_key', `${T} PRIMARY KEY`],
    ['order_id', T],
    ['category', T],
    ['account', T],
    ['payer_name', T],
    ['price_type', T],
    ['item_code', T],
    ['test', T],
    ['qty', INT],
    ['is_rns', BOOL],
    ['sample_status', T],
    ['source_system', T],
    ['order_created_at', TS],
    ['order_validated_at', TS],
    ['lab_sample_received_at', TS],
    ['rns_at', TS],
    ['new_sample_received_date', TS],
    ['preparation_started_at', TS],
    ['preparation_completed_at', TS],
    ['pathology_completed_at', TS],
    ['result_created_at', TS],
    ['result_validated_at', TS],
    ['date_result', D],
    ['canceled_at', TS],
    ['notes', T],
    ['last_updated_at', TS],
    ['current_status', T],
    ['etl_updated_at', TS]
  ]
}

export const INNO_M_ITEM: TableDef = {
  name: 'inno.m_item',
  columns: [
    ['id', `${INT} PRIMARY KEY`],
    ['item_code', T],
    ['item_code_lis', T],
    ['item_name', T],
    ['item_name_alias', T],
    ['item_name_eng', T],
    ['item_type', T],
    ['lab_code', T],
    ['group_code', T],
    ['group_la', T],
    ['price_group_code', T],
    ['reguler_price', NUM],
    ['tat_rutin', T],
    ['is_outsource', FLAG],
    ['is_non_lab', FLAG],
    ['status', T],
    ['deleted_at', TS],
    ['updated_at', TS]
  ]
}

export const INNO_M_ITEM_GROUP: TableDef = {
  name: 'inno.m_item_group',
  columns: [
    ['id', `${INT} PRIMARY KEY`],
    ['code', T],
    ['description', T],
    ['item_headgroup_code', T],
    ['deleted_at', TS]
  ]
}

export const INNO_M_ITEM_PACKAGE: TableDef = {
  name: 'inno.m_item_package',
  columns: [
    ['id', `${INT} PRIMARY KEY`],
    ['item_code_main', T],
    ['item_code_child', T],
    ['is_non_lab', FLAG],
    ['deleted_at', TS]
  ]
}

export const INNO_M_CUSTOMER: TableDef = {
  name: 'inno.m_customer',
  columns: [
    ['id', `${INT} PRIMARY KEY`],
    ['customer_code', T],
    ['customer_code_lis', T],
    ['customer_name', T],
    ['customer_name_alias', T],
    ['customer_type', T],
    ['customer_city', T],
    ['customer_province', T],
    ['group_price', T],
    ['payment_method', T],
    ['term_of_payment', T],
    ['top_days', INT],
    ['is_active', FLAG],
    ['is_erp', FLAG],
    ['status', T],
    ['deleted_at', TS]
  ]
}

export const INNO_M_CLINICIAN: TableDef = {
  name: 'inno.m_clinician',
  columns: [
    ['id', `${INT} PRIMARY KEY`],
    ['code', T],
    ['code_lis', T],
    ['name', T],
    ['is_patologist', FLAG],
    ['code_specialist', T],
    ['status', T],
    ['deleted_at', TS]
  ]
}

export const INNO_M_REGULER_PRICE: TableDef = {
  name: 'inno.m_reguler_price',
  columns: [
    ['id', `${INT} PRIMARY KEY`],
    ['item_code', T],
    ['k1', NUM],
    ['k2', NUM],
    ['k3', NUM],
    ['k4', NUM],
    ['k5', NUM],
    ['k6', NUM],
    ['k7', NUM],
    ['status', T],
    ['deleted_at', TS],
    ['updated_at', TS]
  ]
}

export const INNO_M_SPECIAL_PRICE: TableDef = {
  name: 'inno.m_special_price',
  columns: [
    ['id', `${INT} PRIMARY KEY`],
    ['customer_code', T],
    ['item_code', T],
    ['item_name', T],
    ['price_category', T],
    ['reguler_price', NUM],
    ['special_price', NUM],
    ['start_date', D],
    ['end_date', D],
    ['status', T],
    ['deleted_at', TS]
  ]
}

export const INNO_M_PRICE_CATEGORY: TableDef = {
  name: 'inno.m_price_category',
  columns: [
    ['code', `${T} PRIMARY KEY`],
    ['name', T],
    ['deleted_at', TS]
  ]
}

export const INNO_T_PKS: TableDef = {
  name: 'inno.t_pks',
  columns: [
    ['id', `${INT} PRIMARY KEY`],
    ['trx_no', T],
    ['trx_date', D],
    ['trx_end_date', D],
    ['customer_code', T],
    ['customer_name', T],
    ['status', T],
    ['invoicing', T],
    ['term_of_payment', T],
    ['payment_method', T],
    ['is_pks', FLAG],
    ['is_voucher', FLAG],
    ['is_package', FLAG],
    ['remarks', T],
    ['deleted_at', TS]
  ]
}

export const TABLES_PUBLIC: readonly TableDef[] = [
  SALES_REPOSITORY,
  M_CUSTOMER,
  M_PROVINCES,
  M_CITIES,
  M_ITEM_REPOSITORY,
  SAMPLE_TRACKER
]
export const TABLES_INNO: readonly TableDef[] = [
  INNO_M_ITEM,
  INNO_M_ITEM_GROUP,
  INNO_M_ITEM_PACKAGE,
  INNO_M_CUSTOMER,
  INNO_M_CLINICIAN,
  INNO_M_REGULER_PRICE,
  INNO_M_SPECIAL_PRICE,
  INNO_M_PRICE_CATEGORY,
  INNO_T_PKS
]
export const ALL_TABLES: readonly TableDef[] = [...TABLES_PUBLIC, ...TABLES_INNO]

export function columnNames(t: TableDef): string[] {
  return t.columns.map(([c]) => c)
}

function createTable(t: TableDef): string {
  return `CREATE TABLE ${t.name} (\n  ${t.columns.map(([c, type]) => `${c} ${type}`).join(',\n  ')}\n)`
}

export const DROP_STATEMENTS: readonly string[] = [
  'DROP VIEW IF EXISTS public.v_sample_tracker',
  ...TABLES_PUBLIC.map((t) => `DROP TABLE IF EXISTS ${t.name}`),
  'DROP SCHEMA IF EXISTS inno CASCADE'
]

export const DDL_PUBLIC: readonly string[] = [
  ...TABLES_PUBLIC.map(createTable),
  `CREATE VIEW public.v_sample_tracker AS SELECT ${columnNames(SAMPLE_TRACKER).join(', ')} FROM public.t_sample_tracker`,
  'CREATE INDEX ON public."SalesRepository" (date_result)',
  'CREATE INDEX ON public."SalesRepository" (date_received)',
  'CREATE INDEX ON public."SalesRepository" (order_id)',
  'CREATE INDEX ON public.t_sample_tracker (order_id)'
]

export const DDL_INNO: readonly string[] = [
  'CREATE SCHEMA inno',
  ...TABLES_INNO.map(createTable),
  'CREATE INDEX ON inno.m_item (item_code)',
  'CREATE INDEX ON inno.m_customer (customer_code)',
  'CREATE INDEX ON inno.m_special_price (customer_code)'
]
