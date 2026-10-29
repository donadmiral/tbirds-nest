type BackNavigation = {
  canGoBack?: () => boolean;
  goBack: () => void;
  navigate: (screen: string) => void;
};

/** Back follows the current flow. A direct/deep-linked screen has a parent. */
export function settingsBack(navigation: BackNavigation, parent = 'Settings') {
  if (navigation.canGoBack?.()) navigation.goBack();
  else navigation.navigate(parent);
}

/** Exit leaves every settings subpage in one step instead of replaying history. */
export function exitSettings(navigation: BackNavigation) {
  navigation.navigate('ProfileMain');
}
