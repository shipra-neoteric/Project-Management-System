/** Names of everything `seed:demo` creates, so `seed:cleanup` removes exactly that and nothing else. */
export const DEMO_PROJECTS = {
  fitOut: 'Corporate Office Fit-out',
  lobby: 'Reception & Lobby Refurbishment',
  program: 'Corporate Real Estate Program',
  template: 'Office Fit-out Template',
} as const;

export const DEMO_PROJECT_NAMES: string[] = Object.values(DEMO_PROJECTS);
