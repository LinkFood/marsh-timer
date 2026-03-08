import { useState, useCallback } from 'react';
import { useAuth } from './useAuth';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface FeedbackState {
  [key: string]: boolean | null; // key = "type:date:state" -> true/false/null
}

export function useFeedback() {
  const { session } = useAuth();
  const [feedback, setFeedback] = useState<FeedbackState>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const feedbackKey = (type: string, date: string, stateAbbr?: string) =>
    `${type}:${date}:${stateAbbr || 'national'}`;

  const submitFeedback = useCallback(async (
    feedbackType: string,
    targetDate: string,
    rating: boolean,
    stateAbbr?: string,
    comment?: string,
  ) => {
    if (!session?.access_token) return;
    const key = feedbackKey(feedbackType, targetDate, stateAbbr);
    setLoading(prev => ({ ...prev, [key]: true }));

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-feedback`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ feedback_type: feedbackType, target_date: targetDate, state_abbr: stateAbbr, rating, comment }),
      });
      if (res.ok) {
        setFeedback(prev => ({ ...prev, [key]: rating }));
      }
    } catch (err) {
      console.error('Feedback error:', err);
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }));
    }
  }, [session]);

  const getFeedback = (type: string, date: string, stateAbbr?: string): boolean | null => {
    return feedback[feedbackKey(type, date, stateAbbr)] ?? null;
  };

  const isLoading = (type: string, date: string, stateAbbr?: string): boolean => {
    return loading[feedbackKey(type, date, stateAbbr)] ?? false;
  };

  const isAuthenticated = !!session;

  return { submitFeedback, getFeedback, isLoading, isAuthenticated };
}
