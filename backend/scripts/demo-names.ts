/** Names of everything `seed:demo` creates, so `seed:cleanup` removes exactly that and nothing else. */
export const DEMO_PROJECTS = {
  portfolio: 'Neoteric Real Estate Portfolio',
  program: 'Corporate Real Estate Program',
  fitOut: 'Corporate Office Fit-out',
  lobby: 'Reception & Lobby Refurbishment',
  dataCentre: 'Data Centre Cooling Upgrade',
  archived: 'EV Charging Bays (FY25)',
  template: 'Office Fit-out Template',
} as const;

export const DEMO_PROJECT_NAMES: string[] = Object.values(DEMO_PROJECTS);

/** Demo team members. They are real accounts, so the boss can sign in as them to see how roles differ. */
export const DEMO_PASSWORD = 'Demo@12345';
export const DEMO_TEAM = [
  { key: 'priya', name: 'Priya Sharma', email: 'priya.sharma@example.com', title: 'Project Architect' },
  { key: 'rahul', name: 'Rahul Verma', email: 'rahul.verma@example.com', title: 'Site Engineer' },
  { key: 'anita', name: 'Anita Desai', email: 'anita.desai@example.com', title: 'MEP Consultant' },
  { key: 'vikram', name: 'Vikram Rao', email: 'vikram.rao@example.com', title: 'Procurement Lead' },
  { key: 'neha', name: 'Neha Kapoor', email: 'neha.kapoor@example.com', title: 'Interior Designer' },
  { key: 'meera', name: 'Meera Nair', email: 'meera.nair@example.com', title: 'Finance Controller' },
  { key: 'arjun', name: 'Arjun Mehta', email: 'arjun.mehta@example.com', title: 'Site Supervisor' },
] as const;
export type DemoKey = (typeof DEMO_TEAM)[number]['key'];

/** Pending invitation (no password yet) and a placeholder for a not-yet-hired contractor. */
export const DEMO_INVITEE = { name: 'Kavita Iyer', email: 'kavita.iyer@example.com' };
export const DEMO_PLACEHOLDER = 'Electrical contractor (to be hired)';

export const DEMO_GROUPS = ['Design team', 'Site engineers'];
export const DEMO_ROLE = 'Site supervisor';
export const DEMO_GLOBAL_ROLE = 'PMO analyst';
export const DEMO_COST_TYPES = ['Gypsum board', 'Paint', 'Electrical cable', 'Vitrified tiles', 'Chiller unit'];
export const DEMO_CUSTOM_FIELDS = ['Contractor', 'Site area (m²)', 'Cost centre', 'Region'];
export const DEMO_PROJECT_LISTS = ['Active projects', 'Programs & portfolios'];
