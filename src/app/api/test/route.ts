import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

function getConnectionConfig() {
  const url = process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim() || null;

  return { url: url || null, key };
}

export async function GET() {
  const { url, key } = getConnectionConfig();

  if (!url || !key) {
    return NextResponse.json(
      {
        data: [],
        error: 'Missing SUPABASE_URL and either SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY',
      },
      { status: 500 }
    );
  }

  try {
    const supabase = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data, error } = await supabase.from('signals').select('*').limit(10);

    return NextResponse.json({
      data: data ?? [],
      error: error?.message ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        data: [],
        error: error instanceof Error ? error.message : 'Unknown Supabase error',
      },
      { status: 500 }
    );
  }
}
