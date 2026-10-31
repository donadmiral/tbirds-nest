import { useEffect, useRef, useState } from 'react';
import { createMemoryPlaybackHook } from '../../shared/useMemoryPlayback';

export const useMemoryPlayback = createMemoryPlaybackHook({ useEffect, useRef, useState });
