/**
 * TierName - a name that wears its owner's verification color.
 * Same tier source as the seal: pass tier directly when the row has it,
 * or a userId for self-lookup through the shared cache. Unverified
 * names keep their base style untouched.
 */
import React from 'react';
import { Text } from 'react-native';
import { getTierColor, useVerifiedTier } from './VerifiedBadge';

type Props = {
  text: string;
  baseStyle?: any;
  userId?: string | null;
  tier?: string | null;
  numberOfLines?: number;
};

export default function TierName({ text, baseStyle, userId, tier, numberOfLines = 1 }: Props) {
  const looked = useVerifiedTier(tier === undefined ? userId : null);
  const resolved = tier !== undefined ? tier : looked;
  const c = getTierColor(resolved);
  return (
    <Text style={[baseStyle, c ? { color: c } : null]} numberOfLines={numberOfLines}>{text}</Text>
  );
}