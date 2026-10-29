type JobsNavigation = {
  canGoBack: () => boolean;
  goBack: () => void;
  navigate: (screen: string, params?: object) => void;
};

export function jobsBack(navigation: JobsNavigation, isBusiness = false) {
  if (navigation.canGoBack()) navigation.goBack();
  else navigation.navigate('Main', { screen: isBusiness ? 'Studio' : 'Jobs' });
}
