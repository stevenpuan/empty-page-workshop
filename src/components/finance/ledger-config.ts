/**
 * 應收／應付共用設定：兩頁的畫面與流程相同，只差資料表、欄位、RPC 與用語。
 * 金額與狀態一律由資料庫 RPC 計算（028_ar_ap_complete），前端只顯示與呼叫。
 */
export type LedgerKind = "ar" | "ap";

export interface LedgerConfig {
  kind: LedgerKind;
  module: "receivables" | "payables";
  title: string;
  description: string;
  /** 帳款 */
  docTable: "receivables" | "payables";
  docLabel: string; // 應收／應付
  docIdKey: "receivable_id" | "payable_id";
  settledCol: "received_amount" | "paid_amount";
  settledLabel: string; // 已收／已付
  openStatuses: string[];
  settledStatus: string;
  docStatus: Record<string, string>;
  /** 對象（客戶／廠商） */
  partyTable: "customers" | "vendors";
  partyFk: "customer_id" | "vendor_id";
  partyCodeCol: "customer_code" | "vendor_code";
  partyLabel: string;
  /** 收付款單 */
  txTable: "collections" | "payments";
  txNoCol: "collection_no" | "payment_no";
  txDateCol: "collect_date" | "pay_date";
  txFk: "collection_id" | "payment_id";
  txLabel: string; // 收款／付款
  actualLabel: string; // 實收金額／實付金額
  prepayLabel: string; // 預收／預付
  allocTable: "collection_allocations" | "payment_allocations";
  source: Record<string, string>;
  /** 手動帳款無法作廢的來源提示 */
  rpc: {
    create: string;
    apply: string;
    voidTx: string;
    writeOff: string;
    createDoc: string;
    updateDoc: string;
    voidDoc: string;
  };
  arg: {
    party: string;
    txDate: string;
    docId: string;
    txId: string;
  };
  feeHelp: string;
  discountHelp: string;
}

export const AR: LedgerConfig = {
  kind: "ar",
  module: "receivables",
  title: "應收與收款",
  description: "應收帳款到期追蹤、收款沖帳、預收款、尾差沖銷。作廢收款會自動反沖。",
  docTable: "receivables",
  docLabel: "應收",
  docIdKey: "receivable_id",
  settledCol: "received_amount",
  settledLabel: "已收",
  openStatuses: ["unreceived", "partial"],
  settledStatus: "received",
  docStatus: { unreceived: "未收", partial: "部分收款", received: "已收清", void: "已作廢" },
  partyTable: "customers",
  partyFk: "customer_id",
  partyCodeCol: "customer_code",
  partyLabel: "客戶",
  txTable: "collections",
  txNoCol: "collection_no",
  txDateCol: "collect_date",
  txFk: "collection_id",
  txLabel: "收款",
  actualLabel: "實收金額",
  prepayLabel: "預收",
  allocTable: "collection_allocations",
  source: { delivery: "出貨", outsource: "外包", manual: "手動", quick: "快單" },
  rpc: {
    create: "allocate_collection",
    apply: "apply_collection",
    voidTx: "void_collection",
    writeOff: "write_off_receivable",
    createDoc: "create_manual_receivable",
    updateDoc: "update_receivable_info",
    voidDoc: "void_receivable",
  },
  arg: {
    party: "p_customer_id",
    txDate: "p_collect_date",
    docId: "p_receivable_id",
    txId: "p_collection_id",
  },
  feeHelp: "客戶匯款時扣掉的匯費，由我方吸收，一樣算沖掉帳款",
  discountHelp: "同意客戶少付的金額（折讓、尾差）",
};

export const AP: LedgerConfig = {
  kind: "ap",
  module: "payables",
  title: "應付與付款",
  description: "應付帳款到期追蹤、付款沖帳、預付款、折讓沖銷。作廢付款會自動反沖。",
  docTable: "payables",
  docLabel: "應付",
  docIdKey: "payable_id",
  settledCol: "paid_amount",
  settledLabel: "已付",
  openStatuses: ["unpaid", "partial"],
  settledStatus: "paid",
  docStatus: { unpaid: "未付", partial: "部分付款", paid: "已付清", void: "已作廢" },
  partyTable: "vendors",
  partyFk: "vendor_id",
  partyCodeCol: "vendor_code",
  partyLabel: "廠商",
  txTable: "payments",
  txNoCol: "payment_no",
  txDateCol: "pay_date",
  txFk: "payment_id",
  txLabel: "付款",
  actualLabel: "實付金額",
  prepayLabel: "預付",
  allocTable: "payment_allocations",
  source: { purchase: "進貨", outsource: "外包", manual: "手動" },
  rpc: {
    create: "allocate_payment",
    apply: "apply_payment",
    voidTx: "void_payment",
    writeOff: "write_off_payable",
    createDoc: "create_manual_payable",
    updateDoc: "update_payable_info",
    voidDoc: "void_payable",
  },
  arg: {
    party: "p_vendor_id",
    txDate: "p_pay_date",
    docId: "p_payable_id",
    txId: "p_payment_id",
  },
  feeHelp: "廠商同意由他負擔、從貨款扣掉的匯費",
  discountHelp: "廠商同意的折讓、尾差",
};

export const METHOD_LABEL: Record<string, string> = {
  cash: "現金",
  transfer: "匯款",
  check: "支票",
  atm: "ATM",
  offset: "沖銷",
  other: "其他",
};

/** 可在新增收付款時選的方式（沖銷由「沖銷」功能產生） */
export const TX_METHODS = ["transfer", "cash", "check", "atm", "other"] as const;

export const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/** 金額四捨五入到小數 2 位（避免 0.1+0.2 這類浮點誤差送進資料庫） */
export const round2 = (n: number): number => Math.round(n * 100) / 100;
