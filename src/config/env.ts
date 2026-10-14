// Build-time configuration (Vite exposes variables prefixed with VITE_). Only PUBLIC values belong here.
const e = import.meta.env;

export const ENV = {
  supabaseUrl: (e.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') ?? '',
  supabaseAnonKey: (e.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '',
  emailDomain: (e.VITE_AUTH_EMAIL_DOMAIN as string | undefined) ?? 'energy.ghrs.app',
  appName: (e.VITE_APP_NAME as string | undefined) ?? 'Energy & Utilities Management Dashboard',
  propertyName: (e.VITE_PROPERTY_NAME as string | undefined) ?? 'Grand Hyatt The Red Sea',
  // The old placeholder value (brand/logo.svg) is ignored so existing .env files pick up the real logo.
  logoPath: ((e.VITE_LOGO_PATH as string | undefined) && e.VITE_LOGO_PATH !== 'brand/logo.svg') ? (e.VITE_LOGO_PATH as string) : 'brand/logo.png',
  base: (e.BASE_URL as string | undefined) ?? '/',
};

export const isConfigured = (): boolean =>
  /^https?:\/\//.test(ENV.supabaseUrl) && ENV.supabaseAnonKey.length > 20 && !ENV.supabaseUrl.includes('YOUR-PROJECT');

export const logoUrl = (): string => `${ENV.base}${ENV.logoPath.replace(/^\//, '')}`;
export const brandUrl = (file: string): string => `${ENV.base}brand/${file}`;
export const templateUrl = (): string => `${ENV.base}templates/Main_Consumption_Opening_Closing.xlsx`;

export const usernameToEmail = (username: string): string => {
  const u = username.trim();
  return u.includes('@') ? u.toLowerCase() : `${u.toLowerCase()}@${ENV.emailDomain}`;
};
