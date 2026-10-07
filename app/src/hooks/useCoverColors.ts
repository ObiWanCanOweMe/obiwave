import { useEffect, useState } from 'react';
import { getColors } from 'react-native-image-colors';
import type { StationImageSource } from '@/lib/api';

export interface CoverColors {
  vibrant: string | null;
  average: string | null;
}

const EMPTY: CoverColors = { vibrant: null, average: null };

export function useCoverColors(coverSrc: StationImageSource | null): CoverColors {
  const [colors, setColors] = useState<CoverColors>(EMPTY);

  useEffect(() => {
    if (!coverSrc) {
      setColors(EMPTY);
      return;
    }
    let cancelled = false;
    getColors(coverSrc.uri, {
      cache: true,
      key: coverSrc.uri,
      quality: 'low',
      ...(coverSrc.headers ? { headers: coverSrc.headers } : {}),
    })
      .then((res) => {
        if (cancelled) return;
        if (res.platform === 'ios') {
          setColors({ vibrant: res.primary, average: res.secondary });
        } else if (res.platform === 'android') {
          setColors({ vibrant: res.vibrant, average: res.average ?? res.muted });
        } else {
          setColors(EMPTY);
        }
      })
      .catch(() => {
        if (!cancelled) setColors(EMPTY);
      });
    return () => {
      cancelled = true;
    };
  }, [coverSrc]);

  return colors;
}
