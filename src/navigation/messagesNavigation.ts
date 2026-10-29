type MessagesNavigation = {
  canGoBack?: () => boolean;
  goBack: () => void;
  navigate: (name: string, params?: object) => void;
  popToTop?: () => void;
};

export function messagesBack(navigation: MessagesNavigation) {
  if (navigation.canGoBack?.()) navigation.goBack();
  else navigation.navigate('Main', { screen: 'Messages', params: { screen: 'Conversations' } });
}

// Composer screens live inside the Messages stack; Chat lives in the root
// stack. Clearing the composer synchronously gives Chat one reliable exit.
export function openChatFromComposer(navigation: MessagesNavigation, params: object) {
  navigation.popToTop?.();
  navigation.navigate('Chat', params);
}
