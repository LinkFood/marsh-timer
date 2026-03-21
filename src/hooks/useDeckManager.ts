import { useState, useEffect, useCallback } from 'react';
import type { DeckConfig, PanelInstance, GridPreset } from '@/panels/PanelTypes';
import { supabase } from '@/lib/supabase';

export function useDeckManager() {
  const [configs, setConfigs] = useState<DeckConfig[]>([]);
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadConfigs = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('hunt_deck_configs')
        .select('*')
        .order('is_builtin', { ascending: false })
        .order('name');
      if (error) throw error;
      setConfigs((data || []) as DeckConfig[]);
    } catch (err) {
      console.error('[DeckManager] Failed to load configs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);

  const saveConfig = useCallback(async (
    name: string,
    panels: PanelInstance[],
    gridPreset: GridPreset,
    activeLayers: string[]
  ) => {
    if (!supabase) return null;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('hunt_deck_configs')
      .insert({
        user_id: user.id,
        name,
        panels,
        grid_preset: gridPreset,
        active_layers: activeLayers,
      })
      .select()
      .single();

    if (error) {
      console.error('[DeckManager] Failed to save config:', error);
      return null;
    }

    await loadConfigs();
    return data as DeckConfig;
  }, [loadConfigs]);

  const deleteConfig = useCallback(async (id: string) => {
    if (!supabase) return false;

    const { error } = await supabase
      .from('hunt_deck_configs')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[DeckManager] Failed to delete config:', error);
      return false;
    }

    if (activeConfigId === id) setActiveConfigId(null);
    await loadConfigs();
    return true;
  }, [activeConfigId, loadConfigs]);

  return {
    configs,
    activeConfigId,
    setActiveConfigId,
    loading,
    saveConfig,
    deleteConfig,
    loadConfigs,
  };
}
