// Every string the UI shows lives here, so an Arabic version can be added later
// by providing the same shape in another language.

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const strings = {
  app: {
    name: 'AeroPress Lab',
    loading: 'Loading…',
  },

  tabs: {
    board: 'Board',
    beans: 'Beans',
    recipes: 'Recipes',
    brew: 'Brew',
    duel: 'Duel',
    coach: 'Coach',
    label: 'Main sections',
  },

  common: {
    back: 'Back',
    cancel: 'Cancel',
    close: 'Close',
    show: 'Show',
    hide: 'Hide',
    retry: 'Try again',
    saving: 'Saving…',
    owner: 'Owner',
    barista: 'Barista',
    you: 'You',
  },

  setup: {
    title: 'Set up your team',
    intro: 'You only do this once. You become the owner; everyone else joins as a barista.',
    teamName: 'Team name',
    teamNamePlaceholder: 'e.g. Kurdi Coffee Lab',
    ownerName: 'Your name',
    ownerNamePlaceholder: 'e.g. Abdelrahman Kurdi',
    ownerPin: 'Owner PIN',
    ownerPinHint: 'Only you use this. It unlocks the owner settings. 4 to 8 digits.',
    ownerPinRepeat: 'Repeat owner PIN',
    teamPin: 'Team PIN',
    teamPinHint: 'Baristas sign in with this. Use 6 digits or more, and not your owner PIN.',
    teamPinRepeat: 'Repeat team PIN',
    submit: 'Create team',
    submitting: 'Creating team…',
    teamNameRequired: 'Enter a team name.',
    ownerNameRequired: 'Enter your name.',
    pinFormat: 'PINs are 4 to 8 digits.',
    ownerPinMismatch: 'The two owner PINs don’t match. Type them again.',
    teamPinMismatch: 'The two team PINs don’t match. Type them again.',
    pinsMustDiffer: 'The owner PIN and the team PIN must be different.',
  },

  signIn: {
    whoIsBrewing: 'Who’s brewing?',
    pickName: 'Tap your name to sign in.',
    noMembers: 'No one is on the team yet.',
    notYou: 'Not you?',
    hi: (name: string) => `Hi, ${name.split(' ')[0] ?? name}`,
    enterOwnerPin: 'Enter your owner PIN',
    enterPersonalPin: 'Enter your PIN',
    enterTeamPin: 'Enter the team PIN',
    submit: 'Sign in',
    submitting: 'Signing in…',
    deleteDigit: 'Delete last digit',
    digitsEntered: (n: number) => `${plural(n, 'digit', 'digits')} entered`,
  },

  shell: {
    openSettings: 'Settings and sign out',
  },

  board: {
    title: 'Board',
    greeting: (name: string) => `Hi, ${name.split(' ')[0] ?? name}`,
    addTeamTitle: 'Add your baristas',
    addTeamBody: 'Add everyone who trains with you. They sign in with the team PIN.',
    addTeamAction: 'Add baristas',
    emptyTitle: 'Nothing to track yet',
    emptyBody: 'Progress, consistency and readiness show up here once beans, recipes and brews are logged.',
  },

  comingSoon: {
    beans: { title: 'Beans', body: 'Bean list, roast dates and the competition coffee arrive in phase 2.' },
    recipes: { title: 'Recipes', body: 'Recipes, clone-and-tweak, compare and lineage arrive in phase 2.' },
    brew: { title: 'Brew', body: 'The big step timer and the brew log arrive in phase 3.' },
    duel: { title: 'Duel', body: 'Blind multi-phone duels and Elo ranking arrive in phase 4.' },
    coach: { title: 'Coach', body: 'The AI coach arrives in phase 5.' },
    label: 'Coming soon',
  },

  settings: {
    title: 'Settings',
    you: 'You',
    theme: 'Theme',
    themeSystem: 'System',
    themeLight: 'Light',
    themeDark: 'Dark',
    team: 'Team',
    members: 'Members',
    membersCount: (n: number) => plural(n, 'active member', 'active members'),
    changeTeamPin: 'Change team PIN',
    changeTeamPinBody: 'Baristas who sign in with the team PIN use the new one from their next sign-in. Anyone signed in now stays signed in.',
    newTeamPin: 'New team PIN',
    saveTeamPin: 'Save team PIN',
    teamPinSaved: 'Team PIN changed.',
    signOut: 'Sign out',
    signingOut: 'Signing out…',
  },

  members: {
    title: 'Members',
    addTitle: 'Add a barista',
    addName: 'Name',
    addNamePlaceholder: 'e.g. Lina Haddad',
    addSubmit: 'Add barista',
    nameRequired: 'Enter their name.',
    added: (name: string) => `${name} added. They sign in with the team PIN.`,
    active: 'Active',
    inactive: 'Deactivated',
    locked: 'Locked',
    signsInWith: {
      owner: 'Owner PIN',
      personal: 'Own PIN',
      team: 'Team PIN',
    },
    lockedFor: (minutes: number) => `Locked for ${plural(minutes, 'minute', 'minutes')}`,
    sheet: {
      signsInWith: 'Signs in with',
      resetPin: 'Reset PIN',
      resetPinBody: (name: string) =>
        `Give ${name} a personal PIN. They sign in with it instead of the team PIN, and they’re signed out on their other phones.`,
      changeOwnerPin: 'Change owner PIN',
      changeOwnerPinBody: 'You stay signed in here. Other phones signed in as you are signed out.',
      newPin: 'New PIN',
      savePersonalPin: 'Set personal PIN',
      saveOwnerPin: 'Save owner PIN',
      pinSaved: 'PIN saved.',
      useTeamPin: 'Use the team PIN again',
      useTeamPinBody: 'Removes their personal PIN.',
      usingTeamPin: 'They sign in with the team PIN again.',
      deactivate: 'Deactivate',
      deactivateNamed: (name: string) => `Deactivate ${name}`,
      deactivateBody: 'Signs them out everywhere and hides them from the sign-in list. Their brews and recipes stay.',
      reactivate: 'Reactivate',
      reactivateNamed: (name: string) => `Reactivate ${name}`,
      reactivateBody: 'Puts them back on the sign-in list.',
      deactivated: (name: string) => `${name} is deactivated.`,
      reactivated: (name: string) => `${name} is back on the team.`,
    },
  },

  errors: {
    offline: 'You’re offline. Check the connection and try again.',
    generic: 'Something went wrong. Try again in a moment.',
    loadFailed: 'Couldn’t load the app. Check the connection and try again.',
    // Keyed by API error code. Functions receive the error body.
    byCode: {
      not_signed_in: 'You’re signed out. Sign in again to continue.',
      owner_only: 'Only the owner can do this.',
      wrong_pin: (e: { tries_left?: number }) =>
        e.tries_left === undefined
          ? 'Wrong PIN. Try again.'
          : `Wrong PIN. ${plural(e.tries_left, 'try', 'tries')} left before a 15-minute lock.`,
      locked: (e: { retry_after_ms?: number }) => {
        const minutes = Math.max(1, Math.ceil((e.retry_after_ms ?? 15 * 60_000) / 60_000));
        return `Too many wrong PINs. Try again in ${plural(minutes, 'minute', 'minutes')}.`;
      },
      member_not_found: 'That name is no longer on the team. Go back and pick your name again.',
      already_set_up: 'This team is already set up. Sign in instead.',
      name_taken: 'Someone on the team already has that name. Add a last initial to tell them apart.',
      pin_matches_team: 'The owner PIN must differ from the team PIN. Pick another PIN.',
      pin_matches_owner: 'The team PIN must differ from the owner PIN. Pick another PIN.',
      server_error: 'Something went wrong on our side. Try again in a moment. If it keeps happening, tell the owner.',
    } as Record<string, string | ((e: Record<string, unknown>) => string)>,
  },
};

export type Strings = typeof strings;
