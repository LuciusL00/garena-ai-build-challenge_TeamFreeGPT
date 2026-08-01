'use client';

import { useEffect } from 'react';

export default function SwarmfallPage() {
  useEffect(() => {
    void import('../demos/swarmfall/src/main.ts');
  }, []);

  return <div id="app" />;
}
