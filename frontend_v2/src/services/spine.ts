import { api } from "@/lib/api";

/** One station of the order spine: master → quote → order → plan → floor → yard → dispatch. */
export type SpineStationState = "done" | "active" | "pending" | "skipped" | "blocked";

export interface SpineStation {
  key: "master" | "quote" | "order" | "plan" | "floor" | "yard" | "dispatch";
  label: string;
  state: SpineStationState;
  value: string;
  href: string;
  detail: string;
}

export interface SpineMadeLayer {
  index: number;
  name: string;
  micron: number | null;
  grade: string;
  source: string;
  density: number | null;
  width_mm: number | null;
  kg: number | null;
}

export interface SpineMadeLine {
  item_id: string;
  headline: string;
  product: string;
  fg_type: string;
  pouch_style: string;
  size: string;
  width_mm?: number | null;
  height_mm?: number | null;
  gusset_mm?: number | null;
  layers: SpineMadeLayer[];
  gauge_micron?: number | null;
  colours?: number;
  artwork?: string;
  print_method?: string;
  qty: string;
  structure: string;
  print: string;
  route: string;
  lanes: string;
  unit_weight_g: number | null;
  total_kg: number;
  line_status: string;
}

export interface SpineMade {
  headline: string;
  structure: string;
  print: string;
  route: string;
  lanes: string;
  unit_weight_g: number | null;
  layers?: SpineMadeLayer[];
  size?: string;
  pouch_style?: string;
  artwork?: string;
  colours?: number;
  gauge_micron?: number | null;
  total_kg: number;
  line_count: number;
  lines: SpineMadeLine[];
  due: string | null;
  customer_name: string;
}

export interface OrderSpine {
  order_id: string | null;
  order_number?: string;
  customer_name?: string;
  status?: string;
  delivery_date?: string | null;
  stations: SpineStation[];
  made: SpineMade | null;
  focus_job_id: string | null;
}

export const spineService = {
  /** Spine for a sales order. */
  forOrder: async (orderId: string, signal?: AbortSignal) => {
    const { data } = await api.get<OrderSpine>(`/api/sales/orders/${orderId}/spine/`, { signal });
    return data;
  },
  /** Spine for the sales order behind a production job (stations empty for stock jobs). */
  forJob: async (jobId: string, signal?: AbortSignal) => {
    const { data } = await api.get<OrderSpine>(`/api/production/jobs/${jobId}/spine/`, { signal });
    return data;
  },
};
