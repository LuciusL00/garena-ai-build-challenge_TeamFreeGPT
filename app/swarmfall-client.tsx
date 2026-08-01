'use client';

import { useEffect } from 'react';

export default function SwarmfallClient() {
  useEffect(() => {
    void import('../demos/swarmfall/src/main.ts');
  }, []);

  return <div id="app" />;
}
