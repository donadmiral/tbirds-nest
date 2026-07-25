/**
 * ImmersiveReplyField.tsx
 *
 * Territorial interaction. Controls are visible and touchable.
 * Premium does NOT mean invisible. Users must instantly perceive actions.
 * All interactive elements: minimum 44px touch target.
 */
import React from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Keyboard, Platform, Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ReAnimated, { SharedValue, useAnimatedStyle, interpolate } from 'react-native-reanimated';
import { palette } from '../../constants/tokens';

const PLATINUM_WHITE = palette.platinumWhite;

type ImmersiveReplyFieldProps = {
  replyMode: boolean;
  replyText: string;
  onChangeText: (text: string) => void;
  sendingReply: boolean;
  heartActive: boolean;
  chromeOpacity: SharedValue<number>;
  onOpenReply: () => void;
  onCloseReply: () => void;
  onSendReply: () => void;
  onHeartTap: () => void;
  onLongPressHeart: () => void;
  canSend: boolean;
  keyboardHeight: number;
  bottomInset: number;
  inputRef: React.RefObject<TextInput | null>;
};

const ImmersiveReplyField = React.memo(function ImmersiveReplyField({
  replyMode, replyText, onChangeText, sendingReply, heartActive, chromeOpacity,
  onOpenReply, onCloseReply, onSendReply, onHeartTap, onLongPressHeart,
  canSend, keyboardHeight, bottomInset, inputRef,
}: ImmersiveReplyFieldProps) {
  const territoryStyle = useAnimatedStyle(() => {
    const opacity = replyMode ? 1 : interpolate(chromeOpacity.value, [0.45, 0.7, 1], [0.4, 0.7, 0.9]);
    return { opacity };
  });

  if (replyMode) {
    return (
      <ReAnimated.View
        style={[s.activeContainer, {
          bottom: keyboardHeight > 0
            ? (Platform.OS === 'android' ? keyboardHeight - bottomInset : keyboardHeight) : 0,
          paddingBottom: keyboardHeight > 0 ? 12 : Math.max(bottomInset + 10, 20),
        }, territoryStyle]}
        pointerEvents="box-none"
      >
        <TouchableOpacity onPress={onCloseReply} style={s.dismissTap}>
          <Feather name="x" size={19} color="rgba(255,255,255,0.92)" />
        </TouchableOpacity>
        <TextInput
          ref={inputRef}
          style={s.textInput}
          placeholder="Say something..."
          placeholderTextColor="rgba(255,255,255,0.82)"
          value={replyText}
          onChangeText={onChangeText}
          multiline={false}
          returnKeyType="send"
          onSubmitEditing={() => { if (canSend) onSendReply(); }}
          editable={!sendingReply}
        />
        <TouchableOpacity
          onPress={onSendReply}
          disabled={!canSend}
          style={[s.sendBtn, !canSend && { opacity: 0.3 }]}
          activeOpacity={0.8}
        >
          {sendingReply ? (
            <ActivityIndicator color={PLATINUM_WHITE} size="small" />
          ) : (
            <Feather name="send" size={16} color={PLATINUM_WHITE} />
          )}
        </TouchableOpacity>
      </ReAnimated.View>
    );
  }

  return (
    <ReAnimated.View
      style={[s.defaultContainer, { paddingBottom: Math.max(bottomInset + 10, 20) }, territoryStyle]}
      pointerEvents="box-none"
    >
      <TouchableOpacity style={s.promptTap} activeOpacity={0.7} onPress={onOpenReply}>
        <Text style={s.promptText}>Say something...</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[s.heartCircle, heartActive && s.heartActive]}
        activeOpacity={0.7}
        onPress={onHeartTap}
        onLongPress={onLongPressHeart}
        delayLongPress={300}
      >
        <Feather name="heart" size={19} color={heartActive ? '#FF3B30' : 'rgba(255,255,255,0.92)'} />
      </TouchableOpacity>

      <TouchableOpacity style={s.sendDefault} activeOpacity={0.8} onPress={onOpenReply}>
        <Feather name="send" size={16} color="rgba(255,255,255,0.92)" />
      </TouchableOpacity>
    </ReAnimated.View>
  );
});

export default ImmersiveReplyField;

const s = StyleSheet.create({
  // Active reply
  activeContainer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center',
    gap: 8, paddingHorizontal: 14, paddingTop: 8, zIndex: 14,
  },
  dismissTap: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  textInput: {
    flex: 1, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.28)',
    paddingHorizontal: 16,
    color: '#FFFFFF', fontSize: 15, fontWeight: '500',
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(245,240,235,0.10)',
    alignItems: 'center', justifyContent: 'center',
  },

  // Default territory
  defaultContainer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center',
    gap: 8, paddingHorizontal: 16, paddingTop: 6, zIndex: 14,
  },
  promptTap: {
    flex: 1, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.28)',
    justifyContent: 'center', paddingHorizontal: 16,
  },
  promptText: {
    color: 'rgba(245,240,235,0.35)', fontSize: 14.5, fontWeight: '500',
  },
  heartCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center', justifyContent: 'center',
  },
  heartActive: {
    backgroundColor: 'rgba(255,59,48,0.18)', borderColor: 'rgba(255,59,48,0.30)',
  },
  sendDefault: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
});