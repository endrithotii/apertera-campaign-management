const SUPABASE_URL = 'https://dvxtykjmabmdlltsfjyu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2eHR5a2ptYWJtZGxsdHNmanl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIwMTQwMjgsImV4cCI6MjA3NzU5MDAyOH0.ax9ncCsFscpvNfNHX_fK1TVBWlle4npg6AWTChuqDWg';

export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed.' });

  try {
    const [leaderboardResponse, configResponse] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/rpc/amplify_public_leaderboard`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: '{}'
      }),
      fetch(`${SUPABASE_URL}/rest/v1/amplify_config?select=post_points,repost_points,like_points,comment_points,marketing_pick_points,points_per_entry,last_synced_at&id=eq.true`, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        }
      })
    ]);

    if (!leaderboardResponse.ok) throw new Error(await leaderboardResponse.text());

    const leaderboard = await leaderboardResponse.json();
    const config = configResponse.ok ? (await configResponse.json())[0] || {} : {};
    response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return response.status(200).json({
      updatedAt: config.last_synced_at || new Date().toISOString(),
      rules: {
        post: config.post_points || 15,
        repost: config.repost_points || 5,
        like: config.like_points || 3,
        comment: config.comment_points || 5,
        marketingPick: config.marketing_pick_points || 20,
        pointsPerEntry: config.points_per_entry || 10
      },
      leaderboard
    });
  } catch (error) {
    console.error('Public Amplify leaderboard failed', error);
    return response.status(500).json({ error: 'The public leaderboard could not be loaded.' });
  }
}
