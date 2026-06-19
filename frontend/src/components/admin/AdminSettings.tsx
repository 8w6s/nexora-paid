import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Icon } from "../Icon";
import { NumberInput } from "../NumberInput";
import { useToast } from "../Toast";
import { ToggleSwitch } from "../ToggleSwitch";

interface SettingsView {
  store_name?: string | null;
  ltc_xpub?: string | null;
  required_confirmations?: string | null;
  payment_window_minutes?: string | null;
  xpub_valid?: boolean;
  xpub_type?: string;
  xpub_sample_address?: string;
  email_enabled?: string | boolean | null;
  email_provider?: string | null;
  email_from?: string | null;
  resend_api_key?: string | boolean | null;
  smtp_host?: string | null;
  smtp_port?: string | null;
  smtp_secure?: string | boolean | null;
  smtp_user?: string | null;
  smtp_pass?: string | boolean | null;
  subdomain?: string | null;
  currency?: string | null;
  description?: string | null;
  discord?: string | null;
  youtube?: string | null;
  telegram?: string | null;
  tiktok?: string | null;
  instagram?: string | null;
  allow_change_theme?: string | boolean | null;
  collect_billing?: string | boolean | null;
  show_coupon?: string | boolean | null;
  show_terms?: string | boolean | null;
  precheck_terms?: string | boolean | null;
  show_newsletter?: string | boolean | null;

  enable_tax_calculation?: string | boolean | null;
  tax_rate?: string | null;
  send_invoice_pdfs?: string | boolean | null;
  show_invoice_pdf_link?: string | boolean | null;
  invoice_pdf_header?: string | null;
  invoice_pdf_notes?: string | null;
  invoice_pdf_footer?: string | null;

  enable_automatic_feedbacks?: string | boolean | null;

  enable_affiliate_program?: string | boolean | null;
  make_affiliate_program_public?: string | boolean | null;
  allow_customers_edit_affiliate_code?: string | boolean | null;
  affiliate_percentage?: string | null;

  enable_tickets?: string | boolean | null;

  terms_of_service?: string | null;
  privacy_policy?: string | null;
  refund_policy?: string | null;

  google_analytics?: string | null;
  crisp?: string | null;
  tawk_to?: string | null;
  trustpilot?: string | null;

  discord_client_id?: string | null;
  discord_client_secret?: string | boolean | null;
  discord_bot_token?: string | boolean | null;

  // New properties
  meta_title?: string | null;
  meta_description?: string | null;
  meta_twitter_card?: string | null;
  checkout_color_scheme?: string | null;

  redirect_custom_domain?: string | boolean | null;
  hide_out_of_stock?: string | boolean | null;
  refund_out_of_stock_to_balance?: string | boolean | null;
  maintenance_password?: string | null;

  custom_domain_name?: string | null;

  maintenance_mode?: string | boolean | null;
  custom_header_script?: string | null;
}

type TabType =
  | "identity"
  | "socials"
  | "checkout"
  | "invoices"
  | "feedbacks"
  | "affiliate"
  | "tickets"
  | "legal"
  | "integrations"
  | "email"
  | "discord_bot"
  | "domain"
  | "billing"
  | "misc";

const TestEmailCard: React.FC = () => {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.post("/api/admin/settings/test-email", { to: to.trim() || undefined });
      if (r.ok) toast.success(`Test email sent to ${r.data.to}`);
      else toast.error(r.data?.error || "Failed to send test email");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card sec">
      <span className="section-title">
        <Icon name="bolt" size={16} /> Send Test Email
      </span>
      <p className="section-subtitle">
        Verify your provider config end-to-end. Defaults to your admin address if you leave the field empty.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <input
          className="input"
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="recipient@example.com (optional)"
          style={{ flex: 1 }}
        />
        <button
          type="button"
          className="btn primary"
          onClick={send}
          disabled={busy}
          style={{ minWidth: 130 }}
        >
          {busy ? "Sending…" : "Send test"}
        </button>
      </div>
    </div>
  );
};

export const AdminSettings: React.FC = () => {
  const [s, setS] = useState<SettingsView | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("identity");
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  // Identity state
  const [storeName, setStoreName] = useState("Nexora");
  const [subdomain, setSubdomain] = useState("protonservices");
  const [currency, setCurrency] = useState("USD");
  const [description, setDescription] = useState(
    "Premium digital goods storefront powered by Nexora.",
  );
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [metaTwitterCard, setMetaTwitterCard] = useState("summary_large_image");

  // Checkout state
  const [conf, setConf] = useState("2");
  const [windowMin, setWindowMin] = useState("15");
  const [checkoutColorScheme, setCheckoutColorScheme] = useState("system");
  const [allowChangeTheme, setAllowChangeTheme] = useState(true);
  const [collectBilling, setCollectBilling] = useState(false);
  const [showCoupon, setShowCoupon] = useState(true);
  const [showTerms, setShowTerms] = useState(true);
  const [precheckTerms, setPrecheckTerms] = useState(false);
  const [showNewsletter, setShowNewsletter] = useState(true);

  // Invoices & Tax state
  const [enableTaxCalculation, setEnableTaxCalculation] = useState(false);
  const [taxRate, setTaxRate] = useState("0");
  const [sendInvoicePdfs, setSendInvoicePdfs] = useState(false);
  const [showInvoicePdfLink, setShowInvoicePdfLink] = useState(false);
  const [invoicePdfHeader, setInvoicePdfHeader] = useState("");
  const [invoicePdfNotes, setInvoicePdfNotes] = useState("");
  const [invoicePdfFooter, setInvoicePdfFooter] = useState("");

  // Feedbacks state
  const [enableAutomaticFeedbacks, setEnableAutomaticFeedbacks] = useState(true);

  // Affiliate Program state
  const [enableAffiliateProgram, setEnableAffiliateProgram] = useState(false);
  const [makeAffiliateProgramPublic, setMakeAffiliateProgramPublic] = useState(true);
  const [allowCustomersEditAffiliateCode, setAllowCustomersEditAffiliateCode] = useState(false);
  const [affiliatePercentage, setAffiliatePercentage] = useState("10");

  // Tickets state
  const [enableTickets, setEnableTickets] = useState(true);

  // Legal Pages state
  const [termsOfService, setTermsOfService] = useState("");
  const [privacyPolicy, setPrivacyPolicy] = useState("");
  const [refundPolicy, setRefundPolicy] = useState("");

  // Integrations state
  const [googleAnalytics, setGoogleAnalytics] = useState("");
  const [crisp, setCrisp] = useState("");
  const [tawkTo, setTawkTo] = useState("");
  const [trustpilot, setTrustpilot] = useState("");

  // Email Server state
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailProvider, setEmailProvider] = useState<"resend" | "smtp">("resend");
  const [emailFrom, setEmailFrom] = useState("");
  const [resendApiKey, setResendApiKey] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");

  // Discord Integration state
  const [discordClientId, setDiscordClientId] = useState("");
  const [discordClientSecret, setDiscordClientSecret] = useState("");
  const [discordBotToken, setDiscordBotToken] = useState("");

  // Custom Domain state
  const [customDomainName, setCustomDomainName] = useState("");

  // Socials state
  const [discord, setDiscord] = useState("https://discord.gg/proton");
  const [youtube, setYoutube] = useState("");
  const [telegram, setTelegram] = useState("https://t.me/proton");
  const [tiktok, setTiktok] = useState("");
  const [instagram, setInstagram] = useState("");

  // Misc state
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenancePassword, setMaintenancePassword] = useState("");
  const [redirectCustomDomain, setRedirectCustomDomain] = useState(true);
  const [hideOutOfStock, setHideOutOfStock] = useState(false);
  const [refundOutOfStockToBalance, setRefundOutOfStockToBalance] = useState(false);
  const [customHeaderScript, setCustomHeaderScript] = useState("");

  const load = useCallback(
    () =>
      api
        .get<SettingsView>("/api/admin/settings")
        .then((d) => {
          setS(d);
          setStoreName(d.store_name ?? "Nexora");
          setConf(String(d.required_confirmations ?? 2));
          setWindowMin(String(d.payment_window_minutes ?? 15));

          // Load custom settings
          if (d.subdomain !== undefined && d.subdomain !== null) setSubdomain(d.subdomain);
          if (d.currency !== undefined && d.currency !== null) setCurrency(d.currency);
          if (d.description !== undefined && d.description !== null) setDescription(d.description);

          if (d.discord !== undefined && d.discord !== null) setDiscord(d.discord);
          if (d.youtube !== undefined && d.youtube !== null) setYoutube(d.youtube);
          if (d.telegram !== undefined && d.telegram !== null) setTelegram(d.telegram);
          if (d.tiktok !== undefined && d.tiktok !== null) setTiktok(d.tiktok);
          if (d.instagram !== undefined && d.instagram !== null) setInstagram(d.instagram);

          setAllowChangeTheme(
            d.allow_change_theme === "true" ||
              d.allow_change_theme === true ||
              d.allow_change_theme === undefined ||
              d.allow_change_theme === null,
          );
          setCollectBilling(d.collect_billing === "true" || d.collect_billing === true);
          setShowCoupon(
            d.show_coupon === "true" ||
              d.show_coupon === true ||
              d.show_coupon === undefined ||
              d.show_coupon === null,
          );
          setShowTerms(
            d.show_terms === "true" ||
              d.show_terms === true ||
              d.show_terms === undefined ||
              d.show_terms === null,
          );
          setPrecheckTerms(d.precheck_terms === "true" || d.precheck_terms === true);
          setShowNewsletter(
            d.show_newsletter === "true" ||
              d.show_newsletter === true ||
              d.show_newsletter === undefined ||
              d.show_newsletter === null,
          );

          // Invoices & Tax
          setEnableTaxCalculation(
            d.enable_tax_calculation === "true" || d.enable_tax_calculation === true,
          );
          if (d.tax_rate !== undefined && d.tax_rate !== null) setTaxRate(d.tax_rate);
          setSendInvoicePdfs(d.send_invoice_pdfs === "true" || d.send_invoice_pdfs === true);
          setShowInvoicePdfLink(
            d.show_invoice_pdf_link === "true" || d.show_invoice_pdf_link === true,
          );
          if (d.invoice_pdf_header !== undefined && d.invoice_pdf_header !== null)
            setInvoicePdfHeader(d.invoice_pdf_header);
          if (d.invoice_pdf_notes !== undefined && d.invoice_pdf_notes !== null)
            setInvoicePdfNotes(d.invoice_pdf_notes);
          if (d.invoice_pdf_footer !== undefined && d.invoice_pdf_footer !== null)
            setInvoicePdfFooter(d.invoice_pdf_footer);

          // Feedbacks
          setEnableAutomaticFeedbacks(
            d.enable_automatic_feedbacks === "true" ||
              d.enable_automatic_feedbacks === true ||
              d.enable_automatic_feedbacks === undefined ||
              d.enable_automatic_feedbacks === null,
          );

          // Affiliate Program
          setEnableAffiliateProgram(
            d.enable_affiliate_program === "true" || d.enable_affiliate_program === true,
          );
          setMakeAffiliateProgramPublic(
            d.make_affiliate_program_public === "true" ||
              d.make_affiliate_program_public === true ||
              d.make_affiliate_program_public === undefined ||
              d.make_affiliate_program_public === null,
          );
          setAllowCustomersEditAffiliateCode(
            d.allow_customers_edit_affiliate_code === "true" ||
              d.allow_customers_edit_affiliate_code === true,
          );
          if (d.affiliate_percentage !== undefined && d.affiliate_percentage !== null)
            setAffiliatePercentage(d.affiliate_percentage);

          // Tickets
          setEnableTickets(
            d.enable_tickets === "true" ||
              d.enable_tickets === true ||
              d.enable_tickets === undefined ||
              d.enable_tickets === null,
          );

          // Legal Pages
          if (d.terms_of_service !== undefined && d.terms_of_service !== null)
            setTermsOfService(d.terms_of_service);
          if (d.privacy_policy !== undefined && d.privacy_policy !== null)
            setPrivacyPolicy(d.privacy_policy);
          if (d.refund_policy !== undefined && d.refund_policy !== null)
            setRefundPolicy(d.refund_policy);

          // Integrations
          if (d.google_analytics !== undefined && d.google_analytics !== null)
            setGoogleAnalytics(d.google_analytics);
          if (d.crisp !== undefined && d.crisp !== null) setCrisp(d.crisp);
          if (d.tawk_to !== undefined && d.tawk_to !== null) setTawkTo(d.tawk_to);
          if (d.trustpilot !== undefined && d.trustpilot !== null) setTrustpilot(d.trustpilot);

          // Discord Bot
          if (d.discord_client_id !== undefined && d.discord_client_id !== null)
            setDiscordClientId(d.discord_client_id);
          setDiscordClientSecret(
            typeof d.discord_client_secret === "string" ? d.discord_client_secret : "",
          );
          setDiscordBotToken(typeof d.discord_bot_token === "string" ? d.discord_bot_token : "");

          // SEO/Meta & Checkout Scheme & Domain
          if (d.meta_title !== undefined && d.meta_title !== null) setMetaTitle(d.meta_title);
          if (d.meta_description !== undefined && d.meta_description !== null)
            setMetaDescription(d.meta_description);
          if (d.meta_twitter_card !== undefined && d.meta_twitter_card !== null)
            setMetaTwitterCard(d.meta_twitter_card);
          if (d.checkout_color_scheme !== undefined && d.checkout_color_scheme !== null)
            setCheckoutColorScheme(d.checkout_color_scheme);

          setRedirectCustomDomain(
            d.redirect_custom_domain === "true" ||
              d.redirect_custom_domain === true ||
              d.redirect_custom_domain === undefined ||
              d.redirect_custom_domain === null,
          );
          setHideOutOfStock(d.hide_out_of_stock === "true" || d.hide_out_of_stock === true);
          setRefundOutOfStockToBalance(
            d.refund_out_of_stock_to_balance === "true" ||
              d.refund_out_of_stock_to_balance === true,
          );
          if (d.maintenance_password !== undefined && d.maintenance_password !== null)
            setMaintenancePassword(d.maintenance_password);
          if (d.custom_domain_name !== undefined && d.custom_domain_name !== null)
            setCustomDomainName(d.custom_domain_name);

          setMaintenanceMode(d.maintenance_mode === "true" || d.maintenance_mode === true);
          if (d.custom_header_script !== undefined && d.custom_header_script !== null)
            setCustomHeaderScript(d.custom_header_script);

          // Email Server load
          setEmailEnabled(d.email_enabled === "true" || d.email_enabled === true);
          setEmailProvider((d.email_provider as "resend" | "smtp") ?? "resend");
          setEmailFrom(d.email_from ?? "");
          setResendApiKey(typeof d.resend_api_key === "string" ? d.resend_api_key : "");
          setSmtpHost(d.smtp_host ?? "");
          setSmtpPort(String(d.smtp_port ?? "587"));
          setSmtpSecure(d.smtp_secure === "true" || d.smtp_secure === true);
          setSmtpUser(d.smtp_user ?? "");
          setSmtpPass(typeof d.smtp_pass === "string" ? d.smtp_pass : "");
        })
        .catch(() => {}),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      // 1. Save general storefront settings
      const generalBody: Record<string, unknown> = {
        required_confirmations: Number(conf) || 2,
        payment_window_minutes: Number(windowMin) || 15,
        store_name: storeName,
        subdomain,
        currency,
        description,
        discord,
        youtube,
        telegram,
        tiktok,
        instagram,
        allow_change_theme: allowChangeTheme,
        collect_billing: collectBilling,
        show_coupon: showCoupon,
        show_terms: showTerms,
        precheck_terms: precheckTerms,
        show_newsletter: showNewsletter,

        enable_tax_calculation: enableTaxCalculation,
        tax_rate: Number(taxRate) || 0,
        send_invoice_pdfs: sendInvoicePdfs,
        show_invoice_pdf_link: showInvoicePdfLink,
        invoice_pdf_header: invoicePdfHeader,
        invoice_pdf_notes: invoicePdfNotes,
        invoice_pdf_footer: invoicePdfFooter,

        enable_automatic_feedbacks: enableAutomaticFeedbacks,

        enable_affiliate_program: enableAffiliateProgram,
        make_affiliate_program_public: makeAffiliateProgramPublic,
        allow_customers_edit_affiliate_code: allowCustomersEditAffiliateCode,
        affiliate_percentage: Number(affiliatePercentage) || 0,

        enable_tickets: enableTickets,

        terms_of_service: termsOfService,
        privacy_policy: privacyPolicy,
        refund_policy: refundPolicy,

        google_analytics: googleAnalytics,
        crisp: crisp,
        tawk_to: tawkTo,
        trustpilot: trustpilot,

        discord_client_id: discordClientId,
        meta_title: metaTitle,
        meta_description: metaDescription,
        meta_twitter_card: metaTwitterCard,
        checkout_color_scheme: checkoutColorScheme,

        redirect_custom_domain: redirectCustomDomain,
        hide_out_of_stock: hideOutOfStock,
        refund_out_of_stock_to_balance: refundOutOfStockToBalance,
        maintenance_password: maintenancePassword,

        custom_domain_name: customDomainName,

        maintenance_mode: maintenanceMode,
        custom_header_script: customHeaderScript,
      };
      if (discordClientSecret.trim())
        generalBody.discord_client_secret = discordClientSecret.trim();
      if (discordBotToken.trim()) generalBody.discord_bot_token = discordBotToken.trim();

      await api.put("/api/admin/settings", generalBody);

      // 2. Save email settings.
      // Re-auth gate: rotating resend_api_key or smtp.pass turns every
      // future order receipt + password-reset link into an attacker-
      // controlled message if a stolen cookie does it. Same pattern as
      // the wallet rotation flow — prompt for password BEFORE submitting
      // so an empty/cancelled prompt never reaches the server.
      const emailBody: Record<string, unknown> = {
        enabled: emailEnabled,
        provider: emailProvider,
        from: emailFrom,
      };
      let emailRotatesSecret = false;
      if (emailProvider === "resend") {
        if (resendApiKey.trim()) {
          emailBody.resendApiKey = resendApiKey.trim();
          emailRotatesSecret = true;
        }
      } else {
        emailBody.smtp = {
          host: smtpHost.trim(),
          port: Number(smtpPort) || 587,
          secure: smtpSecure,
          user: smtpUser.trim(),
        };
        if (smtpPass.trim()) {
          (emailBody.smtp as any).pass = smtpPass.trim();
          emailRotatesSecret = true;
        }
      }
      if (emailRotatesSecret) {
        const pw = window.prompt(
          "Confirm your admin password to rotate email credentials — every future receipt and password-reset link will route through this provider.",
        );
        if (pw == null || pw === "") {
          toast.error("Email credential rotation cancelled. Other settings still saved.");
          load();
          return;
        }
        emailBody.currentPassword = pw;
      }
      await api.put("/api/admin/settings/email", emailBody);

      toast.success("All shop settings saved successfully.");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  if (!s)
    return (
      <div className="set-loading">
        <Icon name="spinner" size={24} className="is-spinning" />
      </div>
    );

  const renderTabContent = () => {
    switch (activeTab) {
      case "identity":
        return (
          <div className="set-pane">
            <div className="card sec">
              <span className="section-title">
                <Icon name="home" size={16} /> Shop details
              </span>
              <div className="row2">
                <label className="set-label">
                  <span>Shop Name</span>
                  <input
                    className="input"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder="My Store"
                  />
                  <small className="pay-hint-text">
                    Displayed all over your website and in emails.
                  </small>
                </label>
                <label className="set-label">
                  <span>Subdomain</span>
                  <input
                    className="input"
                    value={subdomain}
                    onChange={(e) => setSubdomain(e.target.value)}
                    placeholder="mysubdomain"
                  />
                  <small className="pay-hint-text">
                    The URL of your shop. It may only contain letters and numbers.
                  </small>
                </label>
              </div>
              <label className="set-label">
                <span>Currency</span>
                <select
                  className="input select-input"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  <option value="USD">USD - US Dollar ($)</option>
                  <option value="EUR">EUR - Euro (€)</option>
                  <option value="GBP">GBP - British Pound (£)</option>
                  <option value="VND">VND - Vietnam Dong (₫)</option>
                </select>
                <small className="pay-hint-text">
                  Default currency in which product prices are displayed.
                </small>
              </label>
            </div>

            <div className="card sec">
              <span className="section-title">
                <Icon name="package" size={16} /> Storefront Assets
              </span>
              <div className="assets-row">
                <div className="asset-upload-box">
                  <span className="asset-upload-title">Logo</span>
                  <div className="asset-upload-area">
                    <Icon name="plus" size={20} className="muted" />
                    <span>Tap to select an image</span>
                  </div>
                </div>
                <div className="asset-upload-box">
                  <span className="asset-upload-title">Favicon</span>
                  <div className="asset-upload-area">
                    <Icon name="plus" size={20} className="muted" />
                    <span>Tap to select an image</span>
                  </div>
                </div>
                <div className="asset-upload-box">
                  <span className="asset-upload-title">Background</span>
                  <div className="asset-upload-area">
                    <Icon name="plus" size={20} className="muted" />
                    <span>Tap to select an image</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="card sec">
              <span className="section-title">
                <Icon name="settings" size={16} /> Description
              </span>
              <label className="set-label">
                <span>Shop Page Description</span>
                <textarea
                  className="input textarea-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="Tell customers about your shop..."
                />
                <small className="pay-hint-text">
                  Displayed on your shop homepage depending on the active theme.
                </small>
              </label>
            </div>

            <div className="card sec">
              <span className="section-title">
                <Icon name="search" size={16} /> Search Engine Optimization (SEO)
              </span>
              <label className="set-label">
                <span>Meta Title</span>
                <input
                  className="input"
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                  placeholder="Proton — Digital goods Store"
                />
                <small className="pay-hint-text">
                  Displayed in the browser tab and search engines.
                </small>
              </label>

              <label className="set-label">
                <span>Meta Description</span>
                <textarea
                  className="input textarea-input"
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  placeholder="Buy premium licenses, accounts, and keys securely..."
                  rows={3}
                />
                <small className="pay-hint-text">Displayed on search engine results page.</small>
              </label>

              <label className="set-label">
                <span>Meta Image</span>
                <div className="asset-upload-area" style={{ height: "90px" }}>
                  <Icon name="plus" size={16} className="muted" />
                  <span>Select SEO Banner</span>
                </div>
              </label>

              <label className="set-label">
                <span>Meta Twitter Card Type</span>
                <select
                  className="input select-input"
                  value={metaTwitterCard}
                  onChange={(e) => setMetaTwitterCard(e.target.value)}
                >
                  <option value="summary_large_image">Large Image Card</option>
                  <option value="summary">Small Image Card</option>
                </select>
              </label>
            </div>
          </div>
        );
      case "socials":
        return (
          <div className="set-pane">
            <div className="card sec">
              <span className="section-title">
                <Icon name="users" size={16} /> Social media accounts
              </span>
              <p className="section-subtitle">
                Link your social media to display icons on your storefront.
              </p>

              <label className="set-label">
                <span>Discord Invitation Link</span>
                <input
                  className="input"
                  value={discord}
                  onChange={(e) => setDiscord(e.target.value)}
                  placeholder="https://discord.gg/yourserver"
                />
              </label>

              <label className="set-label">
                <span>YouTube Channel URL</span>
                <input
                  className="input"
                  value={youtube}
                  onChange={(e) => setYoutube(e.target.value)}
                  placeholder="https://youtube.com/@channel"
                />
              </label>

              <label className="set-label">
                <span>Telegram Username/Group</span>
                <input
                  className="input"
                  value={telegram}
                  onChange={(e) => setTelegram(e.target.value)}
                  placeholder="https://t.me/username"
                />
              </label>

              <label className="set-label">
                <span>TikTok Username</span>
                <input
                  className="input"
                  value={tiktok}
                  onChange={(e) => setTiktok(e.target.value)}
                  placeholder="https://tiktok.com/@username"
                />
              </label>

              <label className="set-label">
                <span>Instagram Profile URL</span>
                <input
                  className="input"
                  value={instagram}
                  onChange={(e) => setInstagram(e.target.value)}
                  placeholder="https://instagram.com/username"
                />
              </label>
            </div>
          </div>
        );
      case "checkout":
        return (
          <div className="set-pane">
            <div className="card sec">
              <span className="section-title">
                <Icon name="receipt" size={16} /> Payment confirmation settings
              </span>
              <div className="row2">
                <label className="set-label">
                  <span>Required confirmations</span>
                  <NumberInput min={1} max={12} value={conf} onChange={setConf} />
                  <small className="pay-hint-text">
                    Confirmations on block explorer to unlock keys.
                  </small>
                </label>
                <label className="set-label">
                  <span>Payment window (minutes)</span>
                  <NumberInput min={5} max={120} value={windowMin} onChange={setWindowMin} />
                  <small className="pay-hint-text">Time a buyer has to complete the payment.</small>
                </label>
              </div>
            </div>

            <div className="card sec">
              <span className="section-title">
                <Icon name="settings" size={16} /> Checkout layout options
              </span>

              <label className="set-label" style={{ marginBottom: "12px" }}>
                <span>Checkout Default Color Scheme</span>
                <select
                  className="input select-input"
                  value={checkoutColorScheme}
                  onChange={(e) => setCheckoutColorScheme(e.target.value)}
                >
                  <option value="system">Follow System Preferences</option>
                  <option value="light">Always Light Mode</option>
                  <option value="dark">Always Dark Mode</option>
                </select>
              </label>

              <div className="switches-grid">
                <div className="setting-switch-row">
                  <div className="switch-info">
                    <strong>Allow Customer to Change Color Scheme</strong>
                    <span>Customers can switch between light/dark mode on checkout.</span>
                  </div>
                  <ToggleSwitch
                    checked={allowChangeTheme}
                    onChange={() => setAllowChangeTheme(!allowChangeTheme)}
                    label="Allow Theme Switch"
                  />
                </div>

                <div className="setting-switch-row">
                  <div className="switch-info">
                    <strong>Collect Billing Address</strong>
                    <span>Ask customer for full name & billing address during card checkout.</span>
                  </div>
                  <ToggleSwitch
                    checked={collectBilling}
                    onChange={() => setCollectBilling(!collectBilling)}
                    label="Collect Billing"
                  />
                </div>

                <div className="setting-switch-row">
                  <div className="switch-info">
                    <strong>Show Coupon Code Textbox</strong>
                    <span>Display the promo/coupon code textbox on review screen.</span>
                  </div>
                  <ToggleSwitch
                    checked={showCoupon}
                    onChange={() => setShowCoupon(!showCoupon)}
                    label="Show Coupon Box"
                  />
                </div>

                <div className="setting-switch-row">
                  <div className="switch-info">
                    <strong>Require Terms Consent</strong>
                    <span>Show mandatory Terms of Service checkbox at checkout.</span>
                  </div>
                  <ToggleSwitch
                    checked={showTerms}
                    onChange={() => setShowTerms(!showTerms)}
                    label="Show Terms Checkbox"
                  />
                </div>

                <div className="setting-switch-row">
                  <div className="switch-info">
                    <strong>Pre-check Terms Consent</strong>
                    <span>Have the terms agreement checkbox pre-checked by default.</span>
                  </div>
                  <ToggleSwitch
                    checked={precheckTerms}
                    onChange={() => setPrecheckTerms(!precheckTerms)}
                    label="Precheck Terms"
                  />
                </div>

                <div className="setting-switch-row">
                  <div className="switch-info">
                    <strong>Show Newsletter Opt-in</strong>
                    <span>Offer customers to join your mailing list for updates.</span>
                  </div>
                  <ToggleSwitch
                    checked={showNewsletter}
                    onChange={() => setShowNewsletter(!showNewsletter)}
                    label="Show Newsletter Opt-in"
                  />
                </div>
              </div>
            </div>
          </div>
        );
      case "invoices":
        return (
          <div className="set-pane">
            <div className="card sec">
              <span className="section-title">
                <Icon name="receipt" size={16} /> Invoices & Tax Settings
              </span>
              <div className="switches-grid">
                <div className="setting-switch-row">
                  <div className="switch-info">
                    <strong>Enable Tax Calculation</strong>
                    <span>If enabled, tax rates will be calculated and appended at checkout.</span>
                  </div>
                  <ToggleSwitch
                    checked={enableTaxCalculation}
                    onChange={() => setEnableTaxCalculation(!enableTaxCalculation)}
                    label="Enable Tax"
                  />
                </div>
              </div>

              {enableTaxCalculation && (
                <label className="set-label">
                  <span>Standard Tax Rate (%)</span>
                  <input
                    className="input"
                    type="number"
                    value={taxRate}
                    onChange={(e) => setTaxRate(e.target.value)}
                    placeholder="0"
                  />
                </label>
              )}
            </div>

            <div className="card sec">
              <span className="section-title">
                <Icon name="package" size={16} /> Invoice PDF Options
              </span>
              <div className="switches-grid">
                <div className="setting-switch-row">
                  <div className="switch-info">
                    <strong>Send Invoice PDFs to Customers</strong>
                    <span>
                      Automatically generate and send a PDF receipt on successful payment.
                    </span>
                  </div>
                  <ToggleSwitch
                    checked={sendInvoicePdfs}
                    onChange={() => setSendInvoicePdfs(!sendInvoicePdfs)}
                    label="Send PDFs"
                  />
                </div>

                <div className="setting-switch-row">
                  <div className="switch-info">
                    <strong>Show Invoice PDF Link on Checkout</strong>
                    <span>
                      Let customers download the PDF directly from the order success page.
                    </span>
                  </div>
                  <ToggleSwitch
                    checked={showInvoicePdfLink}
                    onChange={() => setShowInvoicePdfLink(!showInvoicePdfLink)}
                    label="Show Link"
                  />
                </div>
              </div>

              <label className="set-label">
                <span>Invoice PDF Header (HTML/Rich-Text)</span>
                <textarea
                  className="input textarea-input"
                  value={invoicePdfHeader}
                  onChange={(e) => setInvoicePdfHeader(e.target.value)}
                  placeholder="Company details, Address, VAT ID..."
                  rows={3}
                />
              </label>

              <label className="set-label">
                <span>Invoice PDF Notes</span>
                <textarea
                  className="input textarea-input"
                  value={invoicePdfNotes}
                  onChange={(e) => setInvoicePdfNotes(e.target.value)}
                  placeholder="Thank you for your purchase!"
                  rows={2}
                />
              </label>

              <label className="set-label">
                <span>Invoice PDF Footer</span>
                <textarea
                  className="input textarea-input"
                  value={invoicePdfFooter}
                  onChange={(e) => setInvoicePdfFooter(e.target.value)}
                  placeholder="Terms & Conditions apply."
                  rows={2}
                />
              </label>
            </div>
          </div>
        );
      case "feedbacks":
        return (
          <div className="set-pane">
            <div className="card sec">
              <span className="section-title">
                <Icon name="star" size={16} /> Customer Feedbacks
              </span>
              <p className="section-subtitle">
                Configure how reviews and feedback are handled on your storefront.
              </p>

              <div className="switches-grid">
                <div className="setting-switch-row">
                  <div className="switch-info">
                    <strong>Enable Automatic 5-Star Feedbacks</strong>
                    <span>
                      If a buyer does not leave feedback within 7 days, a 5-star review is
                      automatically logged.
                    </span>
                  </div>
                  <ToggleSwitch
                    checked={enableAutomaticFeedbacks}
                    onChange={() => setEnableAutomaticFeedbacks(!enableAutomaticFeedbacks)}
                    label="Auto Feedbacks"
                  />
                </div>
              </div>
            </div>
          </div>
        );
      case "affiliate":
        return (
          <div className="set-pane">
            <div className="card sec">
              <span className="section-title">
                <Icon name="tag" size={16} /> Affiliate Program
              </span>
              <p className="section-subtitle">
                Reward users for referring customers to your storefront.
              </p>

              <div className="switches-grid">
                <div className="setting-switch-row">
                  <div className="switch-info">
                    <strong>Enable Affiliate Program</strong>
                    <span>
                      Allow affiliates to generate links and earn commissions on referred sales.
                    </span>
                  </div>
                  <ToggleSwitch
                    checked={enableAffiliateProgram}
                    onChange={() => setEnableAffiliateProgram(!enableAffiliateProgram)}
                    label="Enable Affiliate"
                  />
                </div>
              </div>

              {enableAffiliateProgram && (
                <>
                  <div className="switches-grid" style={{ marginTop: "8px" }}>
                    <div className="setting-switch-row">
                      <div className="switch-info">
                        <strong>Make Affiliate Program Public</strong>
                        <span>
                          Auto-generate referral codes for all registered customers by default.
                        </span>
                      </div>
                      <ToggleSwitch
                        checked={makeAffiliateProgramPublic}
                        onChange={() => setMakeAffiliateProgramPublic(!makeAffiliateProgramPublic)}
                        label="Public Affiliate"
                      />
                    </div>

                    <div className="setting-switch-row">
                      <div className="switch-info">
                        <strong>Allow Customers to Edit Codes</strong>
                        <span>Let affiliates customize their custom referral coupon codes.</span>
                      </div>
                      <ToggleSwitch
                        checked={allowCustomersEditAffiliateCode}
                        onChange={() =>
                          setAllowCustomersEditAffiliateCode(!allowCustomersEditAffiliateCode)
                        }
                        label="Edit Codes"
                      />
                    </div>
                  </div>

                  <label className="set-label" style={{ marginTop: "12px" }}>
                    <span>Affiliate Percentage (%)</span>
                    <input
                      className="input"
                      type="number"
                      value={affiliatePercentage}
                      onChange={(e) => setAffiliatePercentage(e.target.value)}
                      placeholder="10"
                    />
                    <small className="pay-hint-text">
                      Percentage of purchase value credited to affiliate balance.
                    </small>
                  </label>
                </>
              )}
            </div>
          </div>
        );
      case "tickets":
        return (
          <div className="set-pane">
            <div className="card sec">
              <span className="section-title">
                <Icon name="ticket" size={16} /> Customer Support Tickets
              </span>
              <p className="section-subtitle">Toggle self-hosted client ticketing integrations.</p>

              <div className="switches-grid">
                <div className="setting-switch-row">
                  <div className="switch-info">
                    <strong>Enable Tickets System</strong>
                    <span>Allow storefront visitors and customers to open support tickets.</span>
                  </div>
                  <ToggleSwitch
                    checked={enableTickets}
                    onChange={() => setEnableTickets(!enableTickets)}
                    label="Enable Tickets"
                  />
                </div>
              </div>
            </div>
          </div>
        );
      case "legal":
        return (
          <div className="set-pane">
            <div className="card sec">
              <span className="section-title">
                <Icon name="shield" size={16} /> Legal & Storefront Policies
              </span>
              <p className="section-subtitle">
                These pages are displayed in your shop footer to set customer expectations.
              </p>

              <label className="set-label">
                <span>Terms of Service</span>
                <textarea
                  className="input textarea-input"
                  value={termsOfService}
                  onChange={(e) => setTermsOfService(e.target.value)}
                  placeholder="Specify rules and guidelines for buyers..."
                  rows={4}
                />
              </label>

              <label className="set-label">
                <span>Privacy Policy</span>
                <textarea
                  className="input textarea-input"
                  value={privacyPolicy}
                  onChange={(e) => setPrivacyPolicy(e.target.value)}
                  placeholder="Specify how customer data is processed..."
                  rows={4}
                />
              </label>

              <label className="set-label">
                <span>Refund Policy</span>
                <textarea
                  className="input textarea-input"
                  value={refundPolicy}
                  onChange={(e) => setRefundPolicy(e.target.value)}
                  placeholder="Detail refund windows or absolute no-refund policies..."
                  rows={4}
                />
              </label>
            </div>
          </div>
        );
      case "integrations":
        return (
          <div className="set-pane">
            <div className="card sec">
              <span className="section-title">
                <Icon name="zap" size={16} /> Third-Party Integrations
              </span>
              <p className="section-subtitle">
                Configure external tracking scripts, metrics, and live chat helpers.
              </p>

              <label className="set-label">
                <span>Google Analytics Measurement ID</span>
                <input
                  className="input"
                  value={googleAnalytics}
                  onChange={(e) => setGoogleAnalytics(e.target.value)}
                  placeholder="G-XXXXXXXXXX"
                />
              </label>

              <label className="set-label">
                <span>Crisp Website ID</span>
                <input
                  className="input"
                  value={crisp}
                  onChange={(e) => setCrisp(e.target.value)}
                  placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
                />
              </label>

              <label className="set-label">
                <span>Tawk.to Property ID / Chat ID</span>
                <input
                  className="input"
                  value={tawkTo}
                  onChange={(e) => setTawkTo(e.target.value)}
                  placeholder="XXXXXXXXXXXXXXXXXXXXX/XXXXXXXXX"
                />
              </label>

              <label className="set-label">
                <span>Trustpilot AFS BCC Email</span>
                <input
                  className="input"
                  value={trustpilot}
                  onChange={(e) => setTrustpilot(e.target.value)}
                  placeholder="your.shop+1234567890@invite.trustpilot.com"
                />
              </label>
            </div>
          </div>
        );
      case "email":
        return (
          <div className="set-pane">
            <div className="card sec">
              <div className="switch-header">
                <span className="section-title">
                  <Icon name="mail" size={16} /> E-mail Notifications
                </span>
                <ToggleSwitch
                  checked={emailEnabled}
                  onChange={() => setEmailEnabled(!emailEnabled)}
                  label="Enable Email Server"
                />
              </div>
              <p className="section-subtitle">
                Send order keys and receipts to customer emails automatically.
              </p>
            </div>

            {emailEnabled && (
              <>
                <div className="card sec">
                  <span className="section-title">Email Server Provider</span>
                  <div className="provider-selector">
                    <button
                      className={`provider-tab-btn ${emailProvider === "resend" ? "active" : ""}`}
                      onClick={() => setEmailProvider("resend")}
                      type="button"
                    >
                      <Icon name="zap" size={14} /> Resend (API Key)
                    </button>
                    <button
                      className={`provider-tab-btn ${emailProvider === "smtp" ? "active" : ""}`}
                      onClick={() => setEmailProvider("smtp")}
                      type="button"
                    >
                      <Icon name="settings" size={14} /> SMTP Server
                    </button>
                  </div>
                </div>

                <div className="card sec">
                  <span className="section-title">Configuration Details</span>
                  <label className="set-label">
                    <span>Sender Address ("From")</span>
                    <input
                      className="input"
                      value={emailFrom}
                      onChange={(e) => setEmailFrom(e.target.value)}
                      placeholder="noreply@yourdomain.com"
                    />
                  </label>

                  {emailProvider === "resend" ? (
                    <label className="set-label">
                      <span>
                        Resend API Key {s.resend_api_key === true && !resendApiKey ? "— saved" : ""}
                      </span>
                      <input
                        className="input"
                        type="password"
                        value={resendApiKey}
                        onChange={(e) => setResendApiKey(e.target.value)}
                        placeholder={
                          s.resend_api_key === true ? "•••••••••••• (leave blank to keep)" : "re_…"
                        }
                      />
                    </label>
                  ) : (
                    <div className="smtp-grid">
                      <div className="row2">
                        <label className="set-label">
                          <span>SMTP Host</span>
                          <input
                            className="input"
                            value={smtpHost}
                            onChange={(e) => setSmtpHost(e.target.value)}
                            placeholder="smtp.mailgun.org"
                          />
                        </label>
                        <label className="set-label">
                          <span>SMTP Port</span>
                          <input
                            className="input"
                            value={smtpPort}
                            onChange={(e) => setSmtpPort(e.target.value)}
                            placeholder="587"
                          />
                        </label>
                      </div>
                      <div className="row2">
                        <label className="set-label">
                          <span>SMTP User / Login</span>
                          <input
                            className="input"
                            value={smtpUser}
                            onChange={(e) => setSmtpUser(e.target.value)}
                            placeholder="postmaster@yourdomain.com"
                          />
                        </label>
                        <label className="set-label">
                          <span>
                            SMTP Password {s.smtp_pass === true && !smtpPass ? "— saved" : ""}
                          </span>
                          <input
                            className="input"
                            type="password"
                            value={smtpPass}
                            onChange={(e) => setSmtpPass(e.target.value)}
                            placeholder={
                              s.smtp_pass === true ? "•••••••••••• (leave blank to keep)" : ""
                            }
                          />
                        </label>
                      </div>
                      <div
                        className="setting-switch-row"
                        style={{
                          borderTop: "1px solid var(--line-strong)",
                          paddingTop: "12px",
                          marginTop: "6px",
                        }}
                      >
                        <div className="switch-info">
                          <strong>SMTP Secure / TLS</strong>
                          <span>Turn on TLS encryption for email delivery.</span>
                        </div>
                        <ToggleSwitch
                          checked={smtpSecure}
                          onChange={() => setSmtpSecure(!smtpSecure)}
                          label="SMTP Secure"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <TestEmailCard />
              </>
            )}
          </div>
        );
      case "discord_bot":
        return (
          <div className="set-pane">
            <div className="card sec">
              <span className="section-title">
                <Icon name="bolt" size={16} /> Discord Bot Integration
              </span>
              <p className="section-subtitle">
                Automate server invites and role assignments on purchase.
              </p>

              <label className="set-label">
                <span>Discord Client ID</span>
                <input
                  className="input"
                  value={discordClientId}
                  onChange={(e) => setDiscordClientId(e.target.value)}
                  placeholder="123456789012345678"
                />
              </label>

              <label className="set-label">
                <span>
                  Discord Client Secret{" "}
                  {s.discord_client_secret === true && !discordClientSecret ? "— saved" : ""}
                </span>
                <input
                  className="input"
                  type="password"
                  value={discordClientSecret}
                  onChange={(e) => setDiscordClientSecret(e.target.value)}
                  placeholder={
                    s.discord_client_secret === true ? "•••••••••••• (leave blank to keep)" : ""
                  }
                />
              </label>

              <label className="set-label">
                <span>
                  Discord Bot Token{" "}
                  {s.discord_bot_token === true && !discordBotToken ? "— saved" : ""}
                </span>
                <input
                  className="input"
                  type="password"
                  value={discordBotToken}
                  onChange={(e) => setDiscordBotToken(e.target.value)}
                  placeholder={
                    s.discord_bot_token === true ? "•••••••••••• (leave blank to keep)" : ""
                  }
                />
              </label>

              <button
                className="btn btn-secondary"
                style={{ alignSelf: "flex-start", marginTop: "8px" }}
                type="button"
              >
                <Icon name="bolt" size={14} /> Invite Bot to Server
              </button>
            </div>
          </div>
        );
      case "domain":
        return (
          <div className="set-pane">
            <div className="card sec">
              <span className="section-title">
                <Icon name="globe" size={16} /> Custom Domain Config
              </span>
              <p className="section-subtitle">
                Connect your own custom domain (e.g. shop.mydomain.com) to your storefront.
              </p>

              <label className="set-label">
                <span>Domain Name</span>
                <input
                  className="input"
                  value={customDomainName}
                  onChange={(e) => setCustomDomainName(e.target.value)}
                  placeholder="shop.yourdomain.com"
                />
              </label>

              {customDomainName && (
                <div style={{ marginTop: "12px" }}>
                  <span
                    className="section-title"
                    style={{ fontSize: "0.86rem", marginBottom: "8px" }}
                  >
                    DNS Setup Instructions
                  </span>
                  <p className="section-subtitle" style={{ fontSize: "0.78rem" }}>
                    Configure the following DNS records with your registrar:
                  </p>

                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "0.8rem",
                      marginTop: "8px",
                      border: "1px solid var(--line-strong)",
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          background: "var(--surface-2)",
                          borderBottom: "1px solid var(--line-strong)",
                        }}
                      >
                        <th style={{ padding: "8px", textAlign: "left", fontWeight: "700" }}>
                          Type
                        </th>
                        <th style={{ padding: "8px", textAlign: "left", fontWeight: "700" }}>
                          Host
                        </th>
                        <th style={{ padding: "8px", textAlign: "left", fontWeight: "700" }}>
                          Value
                        </th>
                        <th style={{ padding: "8px", textAlign: "left", fontWeight: "700" }}>
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ padding: "8px" }}>
                          <code>CNAME</code>
                        </td>
                        <td style={{ padding: "8px" }}>
                          <code>{customDomainName.split(".")[0]}</code>
                        </td>
                        <td style={{ padding: "8px" }}>
                          <code>domains.sellauth.com</code>
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            color: "var(--auto, #137333)",
                            fontWeight: "700",
                          }}
                        >
                          Active
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <div className="xpub-status ok" style={{ marginTop: "12px" }}>
                    <Icon name="check" size={14} />
                    <span>
                      SSL Certificate successfully generated. Your custom domain is fully online.
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      case "billing":
        return (
          <div className="set-pane">
            <div className="card sec">
              <span className="section-title">
                <Icon name="credit-card" size={16} /> Plan Billing & Subscription
              </span>
              <p className="section-subtitle">Manage your SellAuth merchant subscription plan.</p>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "16px",
                  background: "var(--brand-soft, rgba(79, 70, 229, 0.06))",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--brand)",
                }}
              >
                <div>
                  <strong style={{ color: "var(--brand)", fontSize: "1.1rem" }}>
                    Business Plan
                  </strong>
                  <div className="muted" style={{ fontSize: "0.8rem", marginTop: "2px" }}>
                    Next billing date: July 15, 2026 ($19.00/month)
                  </div>
                </div>
                <button
                  className="btn btn-save"
                  style={{ background: "var(--brand)" }}
                  type="button"
                >
                  Change Plan
                </button>
              </div>

              <div style={{ marginTop: "12px" }}>
                <span
                  className="section-title"
                  style={{ fontSize: "0.86rem", marginBottom: "8px" }}
                >
                  Plan Features
                </span>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    fontSize: "0.82rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <li style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Icon name="check" size={14} className="auto" /> 0% Transaction Fees (SellAuth
                    fee)
                  </li>
                  <li style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Icon name="check" size={14} className="auto" /> Custom Domain & Custom Email
                    Servers
                  </li>
                  <li style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Icon name="check" size={14} className="auto" /> Advanced Discord Bot
                    integration
                  </li>
                  <li style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Icon name="check" size={14} className="auto" /> File deliverables upload size
                    up to 2GB
                  </li>
                </ul>
              </div>
            </div>
          </div>
        );
      case "misc":
        return (
          <div className="set-pane">
            <div className="card sec">
              <span className="section-title">
                <Icon name="settings" size={16} /> Miscellaneous settings
              </span>

              <div className="switches-grid">
                <div className="setting-switch-row">
                  <div className="switch-info">
                    <strong>Redirect mysellauth.com to Custom Domain</strong>
                    <span>
                      If enabled, visitors accessing your default subdomain will redirect to your
                      custom domain.
                    </span>
                  </div>
                  <ToggleSwitch
                    checked={redirectCustomDomain}
                    onChange={() => setRedirectCustomDomain(!redirectCustomDomain)}
                    label="Redirect Subdomain"
                  />
                </div>

                <div className="setting-switch-row">
                  <div className="switch-info">
                    <strong>Hide Out of Stock Products</strong>
                    <span>
                      Automatically hide products from your storefront when stock reaches 0.
                    </span>
                  </div>
                  <ToggleSwitch
                    checked={hideOutOfStock}
                    onChange={() => setHideOutOfStock(!hideOutOfStock)}
                    label="Hide Stockout"
                  />
                </div>

                <div className="setting-switch-row">
                  <div className="switch-info">
                    <strong>Refund Out of Stock Items to Balance</strong>
                    <span>
                      Refund customers automatically if the variant goes out of stock during
                      checkouts.
                    </span>
                  </div>
                  <ToggleSwitch
                    checked={refundOutOfStockToBalance}
                    onChange={() => setRefundOutOfStockToBalance(!refundOutOfStockToBalance)}
                    label="Refund to Balance"
                  />
                </div>

                <div className="setting-switch-row">
                  <div className="switch-info">
                    <strong>Enable Maintenance Mode</strong>
                    <span>Show a custom banner and disable buying for storefront visitors.</span>
                  </div>
                  <ToggleSwitch
                    checked={maintenanceMode}
                    onChange={() => setMaintenanceMode(!maintenanceMode)}
                    label="Maintenance Mode"
                  />
                </div>
              </div>

              {maintenanceMode && (
                <label className="set-label" style={{ marginTop: "12px" }}>
                  <span>Maintenance Password</span>
                  <input
                    className="input"
                    type="password"
                    value={maintenancePassword}
                    onChange={(e) => setMaintenancePassword(e.target.value)}
                    placeholder="Enter store password bypass..."
                  />
                  <small className="pay-hint-text">
                    Allows you to bypass the maintenance screen to test checkout.
                  </small>
                </label>
              )}

              <label className="set-label" style={{ marginTop: "12px" }}>
                <span>Custom Header Scripts</span>
                <textarea
                  className="input textarea-input"
                  value={customHeaderScript}
                  onChange={(e) => setCustomHeaderScript(e.target.value)}
                  rows={4}
                  placeholder="<!-- Google Analytics, Custom CSS etc -->"
                />
                <small className="pay-hint-text">
                  Will be injected at the bottom of the &lt;head&gt; tag on storefront pages.
                </small>
              </label>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <div>
          <h2>Configure Storefront</h2>
          <p className="muted">Manage your shop identity, checkouts, and system notifications.</p>
        </div>
        <button className="btn btn-save" onClick={save} disabled={busy}>
          {busy ? (
            <>
              <Icon name="spinner" size={15} className="is-spinning" />
              <span>Saving...</span>
            </>
          ) : (
            <>
              <Icon name="check" size={15} />
              <span>Save Settings</span>
            </>
          )}
        </button>
      </div>

      <div className="settings-layout">
        {/* Left sidebar tabs */}
        <div className="settings-sidebar">
          <button
            className={`settings-tab-btn ${activeTab === "identity" ? "active" : ""}`}
            onClick={() => setActiveTab("identity")}
            type="button"
          >
            <Icon name="home" size={15} />
            <span>Identity</span>
          </button>
          <button
            className={`settings-tab-btn ${activeTab === "socials" ? "active" : ""}`}
            onClick={() => setActiveTab("socials")}
            type="button"
          >
            <Icon name="users" size={15} />
            <span>Socials</span>
          </button>
          <button
            className={`settings-tab-btn ${activeTab === "checkout" ? "active" : ""}`}
            onClick={() => setActiveTab("checkout")}
            type="button"
          >
            <Icon name="cart" size={15} />
            <span>Checkout</span>
          </button>
          <button
            className={`settings-tab-btn ${activeTab === "invoices" ? "active" : ""}`}
            onClick={() => setActiveTab("invoices")}
            type="button"
          >
            <Icon name="receipt" size={15} />
            <span>Invoices & Tax</span>
          </button>
          <button
            className={`settings-tab-btn ${activeTab === "feedbacks" ? "active" : ""}`}
            onClick={() => setActiveTab("feedbacks")}
            type="button"
          >
            <Icon name="star" size={15} />
            <span>Feedbacks</span>
          </button>
          <button
            className={`settings-tab-btn ${activeTab === "affiliate" ? "active" : ""}`}
            onClick={() => setActiveTab("affiliate")}
            type="button"
          >
            <Icon name="tag" size={15} />
            <span>Affiliate Program</span>
          </button>
          <button
            className={`settings-tab-btn ${activeTab === "tickets" ? "active" : ""}`}
            onClick={() => setActiveTab("tickets")}
            type="button"
          >
            <Icon name="ticket" size={15} />
            <span>Tickets</span>
          </button>
          <button
            className={`settings-tab-btn ${activeTab === "legal" ? "active" : ""}`}
            onClick={() => setActiveTab("legal")}
            type="button"
          >
            <Icon name="shield" size={15} />
            <span>Legal Pages</span>
          </button>
          <button
            className={`settings-tab-btn ${activeTab === "integrations" ? "active" : ""}`}
            onClick={() => setActiveTab("integrations")}
            type="button"
          >
            <Icon name="zap" size={15} />
            <span>Integrations</span>
          </button>
          <button
            className={`settings-tab-btn ${activeTab === "email" ? "active" : ""}`}
            onClick={() => setActiveTab("email")}
            type="button"
          >
            <Icon name="mail" size={15} />
            <span>E-mail Server</span>
          </button>
          <button
            className={`settings-tab-btn ${activeTab === "discord_bot" ? "active" : ""}`}
            onClick={() => setActiveTab("discord_bot")}
            type="button"
          >
            <Icon name="bolt" size={15} />
            <span>Discord Bot</span>
          </button>
          <button
            className={`settings-tab-btn ${activeTab === "domain" ? "active" : ""}`}
            onClick={() => setActiveTab("domain")}
            type="button"
          >
            <Icon name="globe" size={15} />
            <span>Custom Domain</span>
          </button>
          <button
            className={`settings-tab-btn ${activeTab === "billing" ? "active" : ""}`}
            onClick={() => setActiveTab("billing")}
            type="button"
          >
            <Icon name="credit-card" size={15} />
            <span>Billing Plan</span>
          </button>
          <button
            className={`settings-tab-btn ${activeTab === "misc" ? "active" : ""}`}
            onClick={() => setActiveTab("misc")}
            type="button"
          >
            <Icon name="settings" size={15} />
            <span>Miscellaneous</span>
          </button>
        </div>

        {/* Right side settings pane */}
        <div className="settings-content-wrapper">{renderTabContent()}</div>
      </div>

      <style>{`
        .settings-page { display: flex; flex-direction: column; gap: 24px; }
        .settings-header { display: flex; justify-content: space-between; align-items: center; gap: 20px; flex-wrap: wrap; }
        .settings-header h2 { font-size: 1.4rem; font-weight: 700; color: var(--ink); margin: 0; }
        
        .settings-layout { display: grid; grid-template-columns: 240px 1fr; gap: 24px; align-items: start; }
        
        /* Sidebar layout */
        .settings-sidebar { display: flex; flex-direction: column; gap: 4px; padding: 6px; background: var(--surface-2); border-radius: var(--radius); border: 1.5px solid var(--line-strong); }
        .settings-tab-btn { display: flex; align-items: center; gap: 10px; width: 100%; padding: 11px 16px; border: none; background: none; font-family: var(--font-sans); font-size: .88rem; font-weight: 600; text-align: left; color: var(--ink-soft); border-radius: var(--radius-sm); cursor: pointer; transition: all 0.15s ease; }
        .settings-tab-btn:hover { background: var(--surface); color: var(--ink); }
        .settings-tab-btn.active { background: var(--brand); color: #FFFFFF; }
        .settings-tab-btn svg { transition: transform 0.15s ease; }
        .settings-tab-btn.active svg { color: #FFFFFF; }

        /* Panel layout */
        .settings-content-wrapper { display: flex; flex-direction: column; }
        .set-pane { display: flex; flex-direction: column; gap: 20px; }
        
        .sec { padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; border: 1.5px solid var(--line-strong); }
        .section-title { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: .94rem; color: var(--ink); }
        .section-title svg { color: var(--brand); }
        .section-subtitle { font-size: .82rem; color: var(--ink-soft); margin-top: -8px; }
        
        .set-label { display: flex; flex-direction: column; gap: 6px; font-size: .82rem; font-weight: 600; color: var(--ink); }
        .set-label span { color: var(--ink); }
        .set-label input, .set-label select, .set-label textarea { width: 100%; padding: 10px 14px; font-size: 0.92rem; border-radius: var(--radius-sm); border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink); transition: border-color 0.15s ease; }
        .set-label input:focus, .set-label select:focus, .set-label textarea:focus { border-color: var(--brand); outline: none; }
        .select-input { appearance: none; background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e"); background-repeat: no-repeat; background-position: right 14px center; background-size: 14px; padding-right: 40px !important; }
        
        .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .textarea-input { font-family: var(--font-sans); line-height: 1.5; resize: vertical; }

        /* Asset uploads */
        .assets-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
        .asset-upload-box { display: flex; flex-direction: column; gap: 8px; }
        .asset-upload-title { font-size: 0.8rem; font-weight: 700; color: var(--ink-soft); }
        .asset-upload-area { height: 110px; border: 1.5px dashed var(--line-strong); border-radius: var(--radius-sm); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; font-size: 0.74rem; font-weight: 600; color: var(--ink-faint); cursor: pointer; transition: all 0.2s ease; background: var(--surface-2); }
        .asset-upload-area:hover { border-color: var(--brand); color: var(--brand); background: var(--surface); }

        /* Switches & Rows */
        .switches-grid { display: flex; flex-direction: column; gap: 12px; }
        .setting-switch-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 14px; background: var(--surface-2); border-radius: var(--radius-sm); border: 1px solid var(--line-strong); }
        .switch-info { display: flex; flex-direction: column; gap: 2px; }
        .switch-info strong { font-size: 0.86rem; color: var(--ink); font-weight: 700; }
        .switch-info span { font-size: 0.76rem; color: var(--ink-soft); }

        /* Email Server specifics */
        .switch-header { display: flex; justify-content: space-between; align-items: center; }
        .provider-selector { display: flex; gap: 8px; width: 100%; }
        .provider-tab-btn { flex: 1; padding: 10px; border: 1px solid var(--line-strong); background: var(--surface-2); border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; gap: 8px; font-family: var(--font-sans); font-size: 0.86rem; font-weight: 700; color: var(--ink-soft); cursor: pointer; transition: all 0.15s ease; }
        .provider-tab-btn:hover { background: var(--surface); border-color: var(--brand); color: var(--brand); }
        .provider-tab-btn.active { background: var(--brand-soft, rgba(79, 70, 229, 0.08)); border-color: var(--brand); color: var(--brand); }

        .smtp-grid { display: flex; flex-direction: column; gap: 16px; }
        
        /* Custom Domain status styles */
        .xpub-status { font-size: .82rem; padding: 10px 14px; border-radius: var(--radius-sm); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; border: 1px solid transparent; }
        .xpub-status.ok { background: var(--auto-soft,#e6f4ea); color: var(--auto,#137333); border-color: rgba(19, 115, 51, 0.2); }
        
        /* Auto styling */
        .auto { color: var(--auto, #137333) !important; }

        .is-spinning { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        @media (max-width: 900px) {
          .settings-layout { grid-template-columns: 1fr; }
        }
        @media (max-width: 560px) {
          .row2 { grid-template-columns: 1fr; }
          .assets-row { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
};
