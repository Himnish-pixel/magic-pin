import customerSeed from "../../dataset/customers_seed.json";
import merchantSeed from "../../dataset/merchants_seed.json";
import triggerSeed from "../../dataset/triggers_seed.json";
import dentists from "../../dataset/categories/dentists.json";
import gyms from "../../dataset/categories/gyms.json";
import pharmacies from "../../dataset/categories/pharmacies.json";
import restaurants from "../../dataset/categories/restaurants.json";
import salons from "../../dataset/categories/salons.json";

export type Customer = {
  customer_id: string;
  merchant_id: string;
  identity: { name?: string; age_band?: string; language_pref?: string };
  relationship?: { visits_total?: number; last_visit?: string; services_received?: string[] };
  state?: string;
  preferences?: Record<string, unknown>;
  consent?: Record<string, unknown>;
};

export type Merchant = {
  merchant_id: string;
  category_slug: string;
  identity: {
    name?: string;
    city?: string;
    locality?: string;
    owner_first_name?: string;
    languages?: string[];
    verified?: boolean;
  };
  subscription?: Record<string, unknown>;
  performance?: {
    window_days?: number;
    views?: number;
    calls?: number;
    directions?: number;
    ctr?: number;
    leads?: number;
    delta_7d?: Record<string, number>;
  };
  offers?: Array<{ id?: string; title?: string; status?: string }>;
  customer_aggregate?: Record<string, number>;
  signals?: string[];
};

export type Trigger = {
  id: string;
  scope: string;
  kind: string;
  source: string;
  merchant_id: string;
  customer_id: string | null;
  payload: Record<string, unknown>;
  urgency: number;
  suppression_key: string;
  expires_at?: string;
};

export type Category = {
  slug: string;
  display_name: string;
  voice?: { tone?: string; register?: string };
  offer_catalog?: Array<{ id: string; title: string; value?: string; audience?: string; type?: string }>;
  peer_stats?: Record<string, number | string>;
  digest?: Array<{ id: string; title: string; summary?: string; actionable?: string }>;
};

export const merchants = merchantSeed.merchants as unknown as Merchant[];
export const customers = customerSeed.customers as Customer[];
export const triggers = triggerSeed.triggers as Trigger[];
export const categories = [dentists, gyms, pharmacies, restaurants, salons] as Category[];