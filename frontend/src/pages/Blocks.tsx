import React, { useState, useEffect } from 'react';
import { fetchBlocks } from '../api/client';
import { BlockTable } from '../components/BlockTable';
import type { BlocksResponse } from '../types';

export const Blocks: React.FC = () => {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<BlocksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(p: number) {
    setLoading(true);
    try {
      const res = await fetchBlocks(p, 20);
      setData(res);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load blocks');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(page);
  }, [page]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '32px', letterSpacing: '4px' }}>BLOCK EXPLORER</h1>
        <button className="btn" onClick={() => load(page)}>⟳ REFRESH</button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="text-center" style={{ padding: '40px', color: 'var(--text-dim)' }}>
            LOADING BLOCKS...
          </div>
        ) : error ? (
          <div className="text-center" style={{ padding: '40px', color: 'var(--color-error)' }}>
            ERROR: {error}
          </div>
        ) : (
          <div style={{ padding: '16px' }}>
            <BlockTable
              blocks={data?.blocks ?? []}
              page={page}
              onPageChange={setPage}
              hasMore={(data?.blocks.length ?? 0) >= 20}
            />
          </div>
        )}
      </div>
    </div>
  );
};
