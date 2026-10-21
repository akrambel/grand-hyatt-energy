import { LayoutDashboard, CalendarDays, PenSquare, Zap, Droplets, Flame, Snowflake, Wallet, Scale, Fuel, BedDouble, GitCompare, Thermometer, Radio, CalendarRange, BarChart3, Bell, Settings, UserCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem { path: string; label: string; icon: LucideIcon; group: string; adminOnly?: boolean; keywords?: string }

export const NAV: NavItem[] = [
  { path: '/', label: 'Overview', icon: LayoutDashboard, group: 'Dashboard', keywords: 'general kpi dashboard home' },
  { path: '/entry', label: 'Daily Entry', icon: PenSquare, group: 'Data', keywords: 'enter readings opening closing meter' },
  { path: '/daily', label: 'Daily Consumption', icon: CalendarDays, group: 'Data', keywords: 'workbook readings table' },
  { path: '/energy', label: 'Energy', icon: Zap, group: 'Utilities', keywords: 'electricity kwh' },
  { path: '/water', label: 'Water', icon: Droplets, group: 'Utilities', keywords: 'm3 domestic' },
  { path: '/gas', label: 'Gas / LPG', icon: Flame, group: 'Utilities', keywords: 'lpg litres' },
  { path: '/chilled', label: 'Chilled Water', icon: Snowflake, group: 'Utilities', keywords: 'cooling ton' },
  { path: '/rooms', label: 'Guest Rooms', icon: BedDouble, group: 'Utilities', keywords: 'rooms 430 keys floors tail villas L00 L01 L02 L03 L04 room details type view connecting btu chilled water occupancy status vacant occupied' },
  { path: '/lpg', label: 'LPG Tanks', icon: Fuel, group: 'Utilities', keywords: 'tank level' },
  { path: '/costs', label: 'Costs', icon: Wallet, group: 'Analysis', keywords: 'tariff price sar' },
  { path: '/budget', label: 'Budget vs Actual', icon: Scale, group: 'Analysis', keywords: 'variance previous year' },
  { path: '/compare', label: 'Daily Comparison', icon: GitCompare, group: 'Analysis', keywords: 'compare days anomaly' },
  { path: '/climate', label: 'Climate & Occupancy', icon: Thermometer, group: 'Environment', keywords: 'temperature occupancy rooms guests weather' },
  { path: '/live', label: 'Live Environment', icon: Radio, group: 'Environment', keywords: 'esp32 sensor humidity pressure bmp280 aht20' },
  { path: '/monthly', label: 'Monthly Reports', icon: CalendarRange, group: 'Reports', keywords: 'month report' },
  { path: '/annual', label: 'Annual Summary', icon: BarChart3, group: 'Reports', keywords: 'year summary fiscal' },
  { path: '/alerts', label: 'Alerts', icon: Bell, group: 'System', keywords: 'notifications' },
  { path: '/admin', label: 'Administration', icon: Settings, group: 'System', adminOnly: true, keywords: 'users import export settings thresholds devices' },
  { path: '/profile', label: 'My Account', icon: UserCircle, group: 'System', keywords: 'password profile' },
];
