import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  Clipboard,
  Clock3,
  MessageCircle,
  RefreshCw,
  Send,
  Sparkles,
  Store,
  Tag,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { categories, customers, merchants, triggers } from "./data";
import type { Category, Customer, Merchant, Trigger } from "./data";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8080").replace(/\/$/, "");

type Action = {
  conversation_id: string;
  trigger_id: string;
  merchant_id: string;
  body: string;
  cta: string;
  send_as: string;
  suppression_key: string;
  rationale: string;
};

type ChatEntry = {
  role: "vera" | "merchant";
  body: string;
  cta?: string;
  action?: "send" | "wait" | "end";
};

type Health = { status: string; contexts?: Record<string, number> };
type ContextResult = { accepted: boolean; current_version?: number; reason?: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Vera couldn't complete that request (${response.status}). ${detail.slice(0, 180)}`);
  }
  return response.json() as Promise<T>;
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function triggerLabel(trigger: Trigger): string {
  const payload = trigger.payload;
  if (trigger.kind === "perf_dip" || trigger.kind === "perf_spike" || trigger.kind === "seasonal_perf_dip") {
    const metric = String(payload.metric || "business metric");
    const delta = typeof payload.delta_pct === "number" ? `${Math.abs(payload.delta_pct * 100)}% ${payload.delta_pct < 0 ? "down" : "up"}` : "performance update";
    return `${titleCase(metric)} · ${delta}`;
  }
  if (trigger.kind === "research_digest") return "Research update";
  if (trigger.kind === "recall_due") return "Customer recall due";
  if (trigger.kind === "renewal_due") return "Subscription renewal";
  if (trigger.kind === "customer_lapsed_hard" || trigger.kind === "customer_lapsed_soft") return "Customer follow-up";
  if (trigger.kind === "competitor_opened") return "Nearby competitor update";
  if (trigger.kind === "review_theme_emerged") return "Review theme";
  return titleCase(trigger.kind);
}

function triggerFacts(category: Category, merchant: Merchant, trigger: Trigger, customer?: Customer): string[] {
  const payload = trigger.payload;
  const facts: string[] = [];
  if (typeof payload.metric === "string" && typeof payload.delta_pct === "number") {
    const movement = payload.delta_pct < 0 ? "down" : "up";
    const baseline = payload.vs_baseline !== undefined ? ` · baseline ${payload.vs_baseline}` : "";
    facts.push(`${titleCase(payload.metric)} ${Math.abs(payload.delta_pct * 100)}% ${movement}${baseline}`);
  }
  const digestId = payload.top_item_id ?? payload.digest_item_id ?? payload.alert_id;
  if (typeof digestId === "string") {
    const digest = category.digest?.find((item) => item.id === digestId);
    if (digest?.title) facts.push(digest.title);
  }
  if (typeof payload.renewal_amount === "number") facts.push(`Renewal amount ₹${payload.renewal_amount.toLocaleString("en-IN")}`);
  if (typeof payload.days_remaining === "number") facts.push(`${payload.days_remaining} days remaining`);
  if (typeof payload.common_quote === "string") facts.push(`Review quote: “${payload.common_quote}”`);
  if (typeof payload.competitor_name === "string") {
    const competitor = [payload.competitor_name, payload.distance_km ? `${payload.distance_km} km away` : "", payload.their_offer ? `Offer: ${payload.their_offer}` : ""]
      .filter(Boolean).join(" · ");
    facts.push(competitor);
  }
  if (typeof payload.festival === "string" && typeof payload.date === "string") facts.push(`${payload.festival} · ${payload.date}`);
  if (typeof payload.theme === "string") facts.push(`${titleCase(payload.theme)} · ${payload.occurrences_30d ?? ""} mentions in 30 days`);
  if (customer?.identity.name) {
    const visitCount = customer.relationship?.visits_total;
    facts.push(`${customer.identity.name}${visitCount !== undefined ? ` · ${visitCount} visits` : ""}${customer.state ? ` · ${titleCase(customer.state)}` : ""}`);
  }
  if (facts.length === 0) {
    const views = merchant.performance?.views;
    const calls = merchant.performance?.calls;
    if (views !== undefined) facts.push(`${views.toLocaleString("en-IN")} profile views${calls !== undefined ? ` · ${calls} calls` : ""}`);
  }
  return facts.slice(0, 3);
}

function Metric({ label, value, icon: Icon }: { label: string; value?: string; icon: typeof Activity }) {
  if (!value) return null;
  return (
    <div className="metric">
      <span className="metric-icon"><Icon size={15} aria-hidden="true" /></span>
      <span className="metric-copy"><span className="metric-value">{value}</span><span className="metric-label">{label}</span></span>
    </div>
  );
}

export default function App() {
  const initialMerchant = merchants[0];
  const initialTrigger = triggers.find((item) => item.merchant_id === initialMerchant.merchant_id);
  const [categorySlug, setCategorySlug] = useState(initialMerchant.category_slug);
  const [merchantId, setMerchantId] = useState(initialMerchant.merchant_id);
  const [triggerId, setTriggerId] = useState(initialTrigger?.id ?? "");
  const [action, setAction] = useState<Action | null>(null);
  const [thread, setThread] = useState<ChatEntry[]>([]);
  const [replyText, setReplyText] = useState("");
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [replyBusy, setReplyBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connection, setConnection] = useState<"checking" | "online" | "offline">("checking");
  const [health, setHealth] = useState<Health | null>(null);
  const [usedTriggerIds, setUsedTriggerIds] = useState<string[]>([]);
  const versions = useRef(new Map<string, number>());
  const chatEnd = useRef<HTMLDivElement>(null);

  const category = categories.find((item) => item.slug === categorySlug) as Category;
  const categoryMerchants = useMemo(() => merchants.filter((item) => item.category_slug === categorySlug), [categorySlug]);
  const merchant = merchants.find((item) => item.merchant_id === merchantId) as Merchant;
  const merchantTriggers = useMemo(() => triggers.filter((item) => item.merchant_id === merchantId), [merchantId]);
  const trigger = merchantTriggers.find((item) => item.id === triggerId) ?? merchantTriggers[0];
  const linkedCustomer = trigger?.customer_id ? customers.find((item) => item.customer_id === trigger.customer_id) : undefined;
  const performance = merchant.performance;
  const facts = trigger ? triggerFacts(category, merchant, trigger, linkedCustomer) : [];
  const activeOffers = merchant.offers?.filter((offer) => offer.status === "active" && offer.title) ?? [];
  const nextTrigger = merchantTriggers.find((item) => item.id !== trigger?.id && !usedTriggerIds.includes(item.id));
  const conversationEnded = thread.some((entry) => entry.action === "end");

  useEffect(() => {
    let mounted = true;
    api<Health>("/v1/healthz")
      .then((data) => { if (mounted) { setHealth(data); setConnection("online"); } })
      .catch(() => { if (mounted) setConnection("offline"); });
    api<Record<string, unknown>>("/v1/metadata").catch(() => undefined);
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [thread, replyBusy]);

  function clearDraft() {
    setAction(null);
    setThread([]);
    setApproved(false);
    setError("");
    setNotice("");
  }

  function chooseCategory(value: string) {
    const firstMerchant = merchants.find((item) => item.category_slug === value);
    if (!firstMerchant) return;
    setCategorySlug(value);
    setMerchantId(firstMerchant.merchant_id);
    setTriggerId(triggers.find((item) => item.merchant_id === firstMerchant.merchant_id)?.id ?? "");
    clearDraft();
  }

  function chooseMerchant(value: string) {
    setMerchantId(value);
    setTriggerId(triggers.find((item) => item.merchant_id === value)?.id ?? "");
    clearDraft();
  }

  function chooseTrigger(value: string) {
    setTriggerId(value);
    clearDraft();
  }

  async function pushContext(scope: string, contextId: string, payload: object) {
    const key = `${scope}:${contextId}`;
    let version = (versions.current.get(key) ?? 0) + 1;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await api<ContextResult>("/v1/context", {
        method: "POST",
        body: JSON.stringify({ scope, context_id: contextId, version, payload }),
      });
      if (result.accepted) {
        versions.current.set(key, version);
        return;
      }
      version = (result.current_version ?? version) + 1;
    }
    throw new Error("Vera couldn't refresh this business context. Please retry.");
  }

  async function createMessage(chosenTrigger = trigger) {
    if (!chosenTrigger || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    setAction(null);
    setThread([]);
    setApproved(false);
    try {
      await pushContext("category", category.slug, category);
      await pushContext("merchant", merchant.merchant_id, merchant);
      await pushContext("trigger", chosenTrigger.id, chosenTrigger);
      const customer = chosenTrigger.customer_id
        ? customers.find((item) => item.customer_id === chosenTrigger.customer_id)
        : undefined;
      if (customer) await pushContext("customer", customer.customer_id, customer);
      const response = await api<{ actions: Action[] }>("/v1/tick", {
        method: "POST",
        body: JSON.stringify({ available_triggers: [chosenTrigger] }),
      });
      void api<Health>("/v1/healthz").then(setHealth).catch(() => setConnection("offline"));
      const generated = response.actions?.[0];
      setUsedTriggerIds((previous) => previous.includes(chosenTrigger.id) ? previous : [...previous, chosenTrigger.id]);
      if (!generated?.body) {
        setError("Vera has already handled this update. Choose another update for a fresh message.");
        return;
      }
      setAction(generated);
      setThread([{ role: "vera", body: generated.body, cta: generated.cta, action: "send" }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function tryAnotherMessage() {
    if (!nextTrigger) return;
    setTriggerId(nextTrigger.id);
    await createMessage(nextTrigger);
  }

  async function copyMessage(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied. Paste it into WhatsApp when you're ready to send.");
    } catch {
      setError("Clipboard access was blocked by the browser. Select the message and copy it manually.");
    }
  }

  async function sendReply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = replyText.trim();
    if (!message || !action || replyBusy || conversationEnded) return;
    setReplyBusy(true);
    setError("");
    setThread((previous) => [...previous, { role: "merchant", body: message }]);
    setReplyText("");
    try {
      const result = await api<{ action: "send" | "wait" | "end"; body?: string; cta?: string; rationale?: string }>("/v1/reply", {
        method: "POST",
        body: JSON.stringify({
          conversation_id: action.conversation_id,
          merchant_id: merchant.merchant_id,
          customer_id: linkedCustomer?.customer_id ?? null,
          from_role: "merchant",
          message,
          turn_number: thread.filter((entry) => entry.role === "merchant").length + 1,
        }),
      });
      setThread((previous) => [...previous, {
        role: "vera",
        body: result.body ?? "",
        cta: result.cta,
        action: result.action,
      }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your reply couldn't reach Vera.");
    } finally {
      setReplyBusy(false);
    }
  }

  const ctrValue = performance?.ctr !== undefined ? `${(performance.ctr * 100).toFixed(1)}%` : undefined;
  const title = merchant.identity.name || "Your business";
  const locality = [merchant.identity.locality, merchant.identity.city].filter(Boolean).join(", ");

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main" aria-label="Vera home">
          <span className="brand-mark"><MessageCircle size={20} strokeWidth={2.4} /></span>
          <span>vera<span className="brand-period">.</span></span>
        </a>
        <div className="topbar-center"><span className="topbar-rule" />MERCHANT STUDIO<span className="topbar-rule" /></div>
        <div className={`connection ${connection}`} aria-live="polite">
          {connection === "online" ? <Wifi size={15} /> : connection === "offline" ? <WifiOff size={15} /> : <span className="status-spinner" />}
          <span>{connection === "online" ? "Vera is ready" : connection === "offline" ? "Vera is offline" : "Connecting"}</span>
        </div>
      </header>

      <div className="workspace" id="main">
        <aside className="sidebar" aria-label="Business selection">
          <div className="sidebar-heading"><span className="eyebrow">YOUR WORKSPACE</span><span className="sidebar-index">01 / 03</span></div>
          <label className="field-label" htmlFor="category-select">Business type</label>
          <div className="select-wrap">
            <select id="category-select" value={categorySlug} onChange={(event) => chooseCategory(event.target.value)}>
              {categories.map((item) => <option key={item.slug} value={item.slug}>{item.display_name}</option>)}
            </select><ChevronDown size={16} aria-hidden="true" />
          </div>

          <label className="field-label" htmlFor="merchant-select">Your outlet</label>
          <div className="select-wrap outlet-select">
            <Store size={16} aria-hidden="true" />
            <select id="merchant-select" value={merchantId} onChange={(event) => chooseMerchant(event.target.value)}>
              {categoryMerchants.map((item) => <option key={item.merchant_id} value={item.merchant_id}>{item.identity.name || item.merchant_id}</option>)}
            </select><ChevronDown size={16} aria-hidden="true" />
          </div>
          <div className="outlet-address">{locality || category.display_name}</div>

          <div className="sidebar-divider" />
          <div className="sidebar-heading updates-heading"><span className="eyebrow">AVAILABLE UPDATES</span><span className="update-count">{merchantTriggers.length}</span></div>
          {merchantTriggers.length ? (
            <div className="update-list" role="group" aria-label="Choose a business update">
              {merchantTriggers.map((item, index) => (
                <button
                  className={`update-option ${trigger?.id === item.id ? "selected" : ""}`}
                  type="button"
                  aria-pressed={trigger?.id === item.id}
                  key={item.id}
                  onClick={() => chooseTrigger(item.id)}
                >
                  <span className="update-marker">{trigger?.id === item.id ? <span /> : String(index + 1).padStart(2, "0")}</span>
                  <span className="update-option-copy"><strong>{triggerLabel(item)}</strong><small>{item.scope === "customer" ? "CUSTOMER FOLLOW-UP" : "BUSINESS UPDATE"}</small></span>
                  <ArrowRight className="update-arrow" size={15} />
                </button>
              ))}
            </div>
          ) : (
            <div className="sidebar-empty">No updates for this outlet in the sample data.</div>
          )}

          <div className="sidebar-bottom">
            <div className="vera-note-mark"><Sparkles size={15} /></div>
            <div><strong>Grounded in your data</strong><span>Vera uses only the business and update details shown here.</span></div>
          </div>
        </aside>

        <section className="main-panel" aria-label="Message studio">
          <div className="page-intro">
            <div>
              <div className="eyebrow coral-eyebrow"><span className="eyebrow-dot" />MESSAGE STUDIO</div>
              <h1>Make the next<br className="title-break" /> message matter.</h1>
              <p className="intro-copy">A clear next step for <strong>{title}</strong>, shaped by what’s happening in your business.</p>
            </div>
            <div className="intro-aside"><span className="intro-aside-number">{String(merchantTriggers.length).padStart(2, "0")}</span><span>real updates<br />to work from</span></div>
          </div>

          <section className="business-strip" aria-label="Selected business context">
            <div className="business-identity">
              <div className="business-icon"><Store size={19} /></div>
              <div><span className="eyebrow">SELECTED OUTLET</span><h2>{title}</h2>{locality && <p>{locality}</p>}</div>
            </div>
            <div className="metrics-row">
              <Metric label={`views · ${performance?.window_days ?? 30} days`} value={performance?.views?.toLocaleString("en-IN")} icon={Activity} />
              <Metric label={`calls · ${performance?.window_days ?? 30} days`} value={performance?.calls?.toLocaleString("en-IN")} icon={MessageCircle} />
              <Metric label="click-through rate" value={ctrValue} icon={ArrowUpRight} />
            </div>
          </section>

          <div className="studio-grid">
            <section className="draft-column" aria-label="Message draft">
              <div className="section-head">
                <div><span className="eyebrow">01 — THE MESSAGE</span><h2>{trigger ? triggerLabel(trigger) : "Choose an update"}</h2></div>
                {trigger && <span className="urgency-tag"><Clock3 size={13} /> Priority {trigger.urgency}</span>}
              </div>

              {trigger ? (
                <div className="message-stage">
                  <div className="message-stage-top"><span><span className="online-dot" />WHATSAPP PREVIEW</span><span>TO {merchant.identity.owner_first_name?.toUpperCase() || "BUSINESS OWNER"}</span></div>
                  {action ? (
                    <div className="message-bubble-wrap">
                      <div className="message-bubble">{action.body}<span className="bubble-time">now <CheckCheck size={13} /></span></div>
                      {action.cta && <div className="message-cta"><ArrowRight size={14} />{action.cta}</div>}
                    </div>
                  ) : (
                    <div className="message-empty">
                      <div className="empty-orbit"><MessageCircle size={24} /></div>
                      <h3>Your next message starts here.</h3>
                      <p>Vera will use the selected update and the outlet details to create a specific, ready-to-review draft.</p>
                      <button className="primary-button" type="button" disabled={busy || connection === "offline"} onClick={() => void createMessage()}>
                        {busy ? <span className="button-spinner" /> : <Sparkles size={17} />}
                        {busy ? "Creating your draft" : "Create message"}
                        {!busy && <ArrowRight size={16} />}
                      </button>
                    </div>
                  )}

                  {error && <div className="inline-error" role="alert"><CircleAlert size={16} /><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError("")}><X size={15} /></button></div>}
                  {notice && <div className="inline-notice" role="status"><Check size={15} />{notice}</div>}

                  {action && (
                    <div className="draft-actions">
                      <button className={`approve-button ${approved ? "is-approved" : ""}`} type="button" onClick={() => { setApproved(true); setNotice("Approved for WhatsApp. Copy the draft below to send it."); }}>
                        {approved ? <Check size={16} /> : <CheckCheck size={16} />}{approved ? "Approved" : "Approve draft"}
                      </button>
                      <button className="secondary-button" type="button" onClick={() => void copyMessage(action.body)}><Clipboard size={15} />Copy text</button>
                      <button className="icon-button" type="button" title="Try another real update" aria-label="Try another real update" disabled={!nextTrigger || busy} onClick={() => void tryAnotherMessage()}><RefreshCw size={16} /></button>
                    </div>
                  )}
                  {approved && <p className="delivery-note"><Check size={13} />Approved here; paste into WhatsApp to deliver.</p>}
                </div>
              ) : (
                <div className="message-stage empty-selection"><div className="message-empty"><div className="empty-orbit"><Store size={24} /></div><h3>No updates for this outlet.</h3><p>Choose another outlet with available seed updates to create a message.</p></div></div>
              )}

              <section className="evidence-section" aria-label="Message source details">
                <div className="section-head compact-head"><div><span className="eyebrow">02 — WHY THIS MESSAGE</span><h2>Details behind the draft</h2></div><span className="verified-label"><Check size={13} />SOURCE DATA</span></div>
                {facts.length ? (
                  <ul className="evidence-list">{facts.map((fact) => <li key={fact}><span className="evidence-tick"><Check size={12} /></span><span>{fact}</span></li>)}</ul>
                ) : <p className="muted-copy">Choose an update to see the facts Vera can use.</p>}
                <div className="offer-line"><Tag size={15} /><span>Active offers</span><strong>{activeOffers.length ? activeOffers.map((offer) => offer.title).join(" · ") : "No active offer recorded"}</strong></div>
              </section>
            </section>

            <aside className="conversation-column" aria-label="Conversation with Vera">
              <div className="conversation-head"><div className="vera-avatar"><Sparkles size={17} /></div><div><strong>Vera</strong><span>Business assistant</span></div><span className="conversation-live"><span />LIVE</span></div>
              <div className="conversation-rule" />
              {!action ? (
                <div className="conversation-empty"><div className="conversation-empty-icon"><MessageCircle size={21} /></div><p>Your conversation will appear here once Vera creates a draft.</p></div>
              ) : (
                <>
                  <div className="thread" aria-live="polite" aria-label="Message history">
                    {thread.map((entry, index) => (
                      <div className={`thread-row ${entry.role}`} key={`${index}-${entry.role}`}>
                        {entry.role === "vera" && <span className="thread-avatar"><Sparkles size={12} /></span>}
                        <div className="thread-content">
                          {entry.action === "end" && <span className="ended-pill"><X size={12} />Conversation ended</span>}
                          {entry.action === "wait" && <span className="wait-pill"><Clock3 size={12} />Vera is waiting</span>}
                          {entry.body && <div className="thread-bubble">{entry.body}</div>}
                          {entry.cta && <span className="thread-cta">{entry.cta}</span>}
                        </div>
                      </div>
                    ))}
                    {replyBusy && <div className="typing-indicator"><span /><span /><span />Vera is thinking</div>}
                    <div ref={chatEnd} />
                  </div>
                  {conversationEnded ? (
                    <div className="conversation-ended"><Check size={15} />This conversation has ended.</div>
                  ) : (
                    <form className="reply-form" onSubmit={(event) => void sendReply(event)}>
                      <label htmlFor="reply-box" className="sr-only">Reply to Vera</label>
                      <textarea id="reply-box" value={replyText} onChange={(event) => setReplyText(event.target.value)} placeholder="Write a reply…" rows={2} disabled={replyBusy} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
                      <div className="reply-form-footer"><span>Enter to send · Shift + Enter for a new line</span><button type="submit" className="send-button" aria-label="Send reply" disabled={!replyText.trim() || replyBusy}><Send size={16} /></button></div>
                    </form>
                  )}
                  <p className="reply-disclaimer">Replies are handled by Vera. WhatsApp delivery is not connected.</p>
                </>
              )}
            </aside>
          </div>
        </section>
      </div>

      <footer className="statusbar">
        <span className="statusbar-brand"><span className="statusbar-dot" />VERA WORKSPACE</span>
        <span className="statusbar-context">{category.display_name}{locality ? ` · ${locality}` : ""}</span>
        <span className="statusbar-right">{health ? `${Object.values(health.contexts ?? {}).reduce((sum, value) => sum + value, 0)} contexts loaded` : "Local sample data"}<span className="status-separator">/</span>PRIVATE PREVIEW</span>
      </footer>
    </main>
  );
}