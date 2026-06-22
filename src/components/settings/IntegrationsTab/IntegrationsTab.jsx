import React, { useState } from 'react';
import { useIntegrationsData } from './useIntegrationsData.js';
import { useConfigForm } from './useConfigForm.js';
import { useIntegrationActions } from './useIntegrationActions.js';
import HomeView from './HomeView.jsx';
import GalleryView from './GalleryView.jsx';
import ConfigView from './ConfigView.jsx';

/**
 * IntegrationsTab — Phase 3 Settings
 *
 * Three views:
 *   1. Home    — list of configured integrations + "Add Integration" button
 *   2. Gallery — browse 42 presets by category, search/filter
 *   3. Config  — form for URL, credentials, test, save (works for both presets and custom)
 *
 * This file is the orchestrator: it owns top-level navigation state, wires the
 * three custom hooks together, and renders the active view. Rendering for each
 * view lives in HomeView.jsx / GalleryView.jsx / ConfigView.jsx.
 */
export default function IntegrationsTab() {
  const [view, setView] = useState('home'); // 'home' | 'gallery' | 'config'
  const [selectedPreset, setSelectedPreset] = useState(null); // null = custom builder
  const [editingType, setEditingType] = useState(null); // set when editing existing (storage key)

  // Kept here so gallery → config → gallery preserves the user's filters.
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');

  const { presets, configured, allContainers, loading, refetch } = useIntegrationsData();
  const form = useConfigForm();

  const goHome = () => {
    setView('home');
    setSelectedPreset(null);
    setEditingType(null);
    refetch();
  };

  const {
    testStatus, setTestStatus,
    saveStatus, setSaveStatus,
    handleTest, handleSave, handleDelete, handleToggle,
  } = useIntegrationActions({
    selectedPreset,
    editingType,
    form,
    refetch,
    onAfterSave: goHome,
  });

  const openGallery = () => {
    setView('gallery');
    setSearch('');
    setCategory('all');
  };

  const openConfig = (preset, existingConfig = null, existingKey = null) => {
    setSelectedPreset(preset);
    setEditingType(existingKey || (existingConfig ? (preset?.type || null) : null));
    form.populate(preset, existingConfig);
    setTestStatus(null);
    setSaveStatus(null);
    setView('config');
  };

  const openCustomBuilder = () => {
    openConfig(null);
  };

  if (loading) {
    return (
      <div className="settings-loading">
        <div className="skeleton" style={{ width: 20, height: 20, borderRadius: '50%' }} />
        <span className="text-mono" style={{ fontSize: 13 }}>Loading integrations...</span>
      </div>
    );
  }

  if (view === 'home') {
    return (
      <HomeView
        presets={presets}
        configured={configured}
        onAddFromPresets={openGallery}
        onCustomBuilder={openCustomBuilder}
        onEdit={openConfig}
        onDelete={handleDelete}
        onToggle={handleToggle}
      />
    );
  }

  if (view === 'gallery') {
    return (
      <GalleryView
        presets={presets}
        configured={configured}
        search={search}
        setSearch={setSearch}
        category={category}
        setCategory={setCategory}
        onPresetClick={openConfig}
        onBack={goHome}
      />
    );
  }

  if (view === 'config') {
    return (
      <ConfigView
        selectedPreset={selectedPreset}
        editingType={editingType}
        form={form}
        allContainers={allContainers}
        testStatus={testStatus}
        saveStatus={saveStatus}
        handleTest={handleTest}
        handleSave={handleSave}
        handleDelete={handleDelete}
        onBack={() => editingType ? goHome() : setView('gallery')}
        onAfterDelete={goHome}
      />
    );
  }

  return null;
}
