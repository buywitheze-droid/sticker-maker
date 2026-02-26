export interface ProfileConfig {
  id: string;
  name: string;
  title: string;
  route: string;
  artboardWidth: number;
  gangsheetHeights: number[];
  downloadFormat: 'png' | 'pdf';
  enableFluorescent: boolean;
  description: string;
}

export const HOT_PEEL_PROFILE: ProfileConfig = {
  id: 'hot-peel',
  name: 'Hot Peel DTF',
  title: 'HOT PEEL DTF',
  route: '/hot-peel',
  artboardWidth: 24.5,
  gangsheetHeights: [12, 18, 24, 35, 40, 45, 48, 50, 55, 60, 65, 70, 80, 85, 95, 110, 120, 130, 140, 150],
  downloadFormat: 'png',
  enableFluorescent: false,
  description: 'Standard DTF gang sheets with PNG export at 300 DPI.',
};

export const FLUORESCENT_PROFILE: ProfileConfig = {
  id: 'fluorescent',
  name: 'Fluorescent Gangsheet',
  title: 'FLUORESCENT GANGSHEET',
  route: '/fluorescent',
  artboardWidth: 24,
  gangsheetHeights: [12, 14, 16, 18],
  downloadFormat: 'pdf',
  enableFluorescent: true,
  description: 'Fluorescent spot color gang sheets with vector PDF export.',
};

export const UV_DTF_PROFILE: ProfileConfig = {
  id: 'uv-dtf',
  name: 'UV-DTF',
  title: 'UV-DTF GANGSHEET',
  route: '/uv-dtf',
  artboardWidth: 22,
  gangsheetHeights: [12, 18, 24, 35, 40, 45, 48, 50, 55, 60, 65, 70, 80, 85, 95, 100],
  downloadFormat: 'png',
  enableFluorescent: false,
  description: 'UV-DTF gang sheets, 22" wide, PNG export at 300 DPI.',
};

export const ALL_PROFILES = [HOT_PEEL_PROFILE, FLUORESCENT_PROFILE, UV_DTF_PROFILE];

export function getProfileById(id: string): ProfileConfig {
  return ALL_PROFILES.find(p => p.id === id) ?? HOT_PEEL_PROFILE;
}
