import { ToggleSwitch } from '../ToggleSwitch/ToggleSwitch';
import { useState, useEffect } from 'react';
import './Settings.css';

interface SettingsProps {
  henrikApiKey: string;
  setHenrikApiKey: (key: string) => void;
  selectedGun: string;
  setSelectedGun: (gun: string) => void;
  showKD: boolean;
  setShowKD: (show: boolean) => void;
  showHS: boolean;
  setShowHS: (show: boolean) => void;
  showWR: boolean;
  setShowWR: (show: boolean) => void;
  showRR: boolean;
  setShowRR: (show: boolean) => void;
  showSkin: boolean;
  setShowSkin: (show: boolean) => void;
  showRank: boolean;
  setShowRank: (show: boolean) => void;
  showPeak: boolean;
  setShowPeak: (show: boolean) => void;
  showLevel: boolean;
  setShowLevel: (show: boolean) => void;
  showParty: boolean;
  setShowParty: (show: boolean) => void;
  showLeaderboard: boolean;
  setShowLeaderboard: (show: boolean) => void;
  skinImageSize: 'small' | 'medium' | 'large';
  setSkinImageSize: (size: 'small' | 'medium' | 'large') => void;
  autoStartWithValorant: boolean;
  setAutoStartWithValorant: (enabled: boolean) => void;
  autoStartWithWindows: boolean;
  setAutoStartWithWindows: (enabled: boolean) => void;
}

const gunOptions = [
  { value: 'vandal', label: 'Vandal' },
  { value: 'phantom', label: 'Phantom' },
  { value: 'operator', label: 'Operator' },
  { value: 'sheriff', label: 'Sheriff' },
  { value: 'spectre', label: 'Spectre' },
  { value: 'ghost', label: 'Ghost' },
  { value: 'classic', label: 'Classic' },
  { value: 'guardian', label: 'Guardian' },
  { value: 'marshal', label: 'Marshal' },
  { value: 'odin', label: 'Odin' },
  { value: 'ares', label: 'Ares' },
  { value: 'bulldog', label: 'Bulldog' },
  { value: 'stinger', label: 'Stinger' },
  { value: 'frenzy', label: 'Frenzy' },
  { value: 'shorty', label: 'Shorty' },
  { value: 'judge', label: 'Judge' },
  { value: 'bucky', label: 'Bucky' },
  { value: 'outlaw', label: 'Outlaw' }
];

interface WeaponImage {
  displayName: string;
  displayIcon: string;
}

export function Settings({
  henrikApiKey,
  setHenrikApiKey,
  selectedGun,
  setSelectedGun,
  showKD,
  setShowKD,
  showHS,
  setShowHS,
  showWR,
  setShowWR,
  showRR,
  setShowRR,
  showSkin,
  setShowSkin,
  showRank,
  setShowRank,
  showPeak,
  setShowPeak,
  showLevel,
  setShowLevel,
  showParty,
  setShowParty,
  showLeaderboard,
  setShowLeaderboard,
  skinImageSize,
  setSkinImageSize,
  autoStartWithValorant,
  setAutoStartWithValorant,
  autoStartWithWindows,
  setAutoStartWithWindows,
}: SettingsProps) {
  const [weaponImages, setWeaponImages] = useState<Record<string, string>>({});
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Fetch weapon images from Valorant API
  useEffect(() => {
    const fetchWeaponImages = async () => {
      try {
        const response = await fetch('https://valorant-api.com/v1/weapons');
        const data = await response.json();
        if (data.status === 200 && data.data) {
          const images: Record<string, string> = {};
          data.data.forEach((weapon: WeaponImage) => {
            const weaponName = weapon.displayName.toLowerCase();
            if (gunOptions.some(opt => opt.value === weaponName)) {
              images[weaponName] = weapon.displayIcon;
            }
          });
          setWeaponImages(images);
        }
      } catch (error) {
        console.error('Failed to fetch weapon images:', error);
      }
    };
    fetchWeaponImages();
  }, []);

  const handleSaveApiKey = async () => {
    if (window.electronAPI) {
      if (henrikApiKey) {
        const result = await window.electronAPI.saveApiKey(henrikApiKey);
        if (result.success) {
          alert('Your custom API key saved securely!');
          await window.electronAPI.saveConfig({ henrikApiKey: henrikApiKey });
        } else {
          alert(`Failed to save API key: ${result.error || 'Unknown error'}`);
        }
      } else {
        const result = await window.electronAPI.saveApiKey('');
        if (result.success) {
          alert('Cleared custom key. Using default API key.');
          await window.electronAPI.saveConfig({ henrikApiKey: '' });
          const config = await window.electronAPI.getConfig();
          if (config.henrikApiKey) {
            setHenrikApiKey(config.henrikApiKey);
          }
        }
      }
    }
  };

  const handleToggleChange = async (
    value: boolean,
    setter: (val: boolean) => void,
    configKey: string
  ) => {
    setter(value);
    if (window.electronAPI) {
      await window.electronAPI.saveConfig({ [configKey]: value });
    }
    
    // If Windows auto-start is disabled, also disable Valorant auto-start
    if (configKey === 'autoStartWithWindows' && !value) {
      setAutoStartWithValorant(false);
      if (window.electronAPI) {
        await window.electronAPI.saveConfig({ autoStartWithValorant: false });
      }
    }
  };

  const handleGunChange = async (newGun: string) => {
    // Update state first to trigger parent component's useEffect
    setSelectedGun(newGun);
    if (window.electronAPI) {
      // Don't call saveConfig here - let getLocalMatch handle it so it can detect the change
      // Trigger a match reload to update skin images immediately if in-game
      // This will call getLocalMatch which triggers forceReprocess() if in-game
      // The state update above will trigger loadCurrentMatch in the parent component,
      // but we also call getLocalMatch here to ensure backend reprocesses immediately
      // and get the updated match data right away
      const updatedMatch = await window.electronAPI.getLocalMatch(newGun);
      // The real-time listener will also update, but this ensures immediate update
      if (updatedMatch) {
        // Trigger a custom event or callback to update match state immediately
        // The parent's loadCurrentMatch will also run, but this ensures we get the data
      }
    }
  };

  return (
    <div className="settings-content">
      <div className="settings-header">
        <h2>Settings</h2>
      </div>
      
      <div className="settings-grid">
        {/* API Key Section */}
        <div className="settings-card">
          <h3 className="settings-card-title">API Configuration</h3>
          <div className="settings-card-content">
            <div className="setting-field">
              <label htmlFor="api-key-settings" className="setting-label">HenrikDev API Key</label>
              <p className="setting-description">Optional: Enter your own API key or use the default</p>
              <input
                id="api-key-settings"
                type="password"
                value={henrikApiKey}
                onChange={(e) => setHenrikApiKey(e.target.value)}
                placeholder="Leave empty to use default key"
                className="setting-input"
              />
              <div className="setting-actions">
                <button onClick={handleSaveApiKey} className="btn-primary">
                  {henrikApiKey ? 'Save Custom Key' : 'Use Default Key'}
                </button>
                <button
                  onClick={() => {
                    window.electronAPI?.openExternalUrl('https://discord.gg/TTxRUpjn');
                  }}
                  className="btn-secondary"
                >
                  Get Your Own Key
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Weapon Selection */}
        <div className="settings-card">
          <h3 className="settings-card-title">Weapon Selection</h3>
          <div className="settings-card-content">
            <div className="setting-field">
              <label htmlFor="gun-select-settings" className="setting-label">Default Weapon</label>
              <p className="setting-description">Select which weapon to display skins for</p>
              <div className="weapon-select-wrapper">
                <div 
                  className="weapon-select-custom"
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
                  tabIndex={0}
                >
                  <div className="weapon-select-selected">
                    {weaponImages[selectedGun] && (
                      <img 
                        src={weaponImages[selectedGun]} 
                        alt="" 
                        className="weapon-select-icon"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    )}
                    <span>{gunOptions.find(opt => opt.value === selectedGun)?.label || selectedGun}</span>
                    <span className="weapon-select-arrow">▼</span>
                  </div>
                  {isDropdownOpen && (
                    <div className="weapon-select-options">
                      {gunOptions.map((gun) => (
                        <div
                          key={gun.value}
                          className={`weapon-select-option ${selectedGun === gun.value ? 'selected' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleGunChange(gun.value);
                            setIsDropdownOpen(false);
                          }}
                        >
                          {weaponImages[gun.value] && (
                            <img 
                              src={weaponImages[gun.value]} 
                              alt="" 
                              className="weapon-select-icon"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          )}
                          <span>{gun.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="setting-field" style={{ marginTop: '24px' }}>
              <label htmlFor="skin-size-select" className="setting-label">Skin Image Size</label>
              <p className="setting-description">Choose the size of weapon skin images</p>
              <select
                id="skin-size-select"
                value={skinImageSize}
                onChange={async (e) => {
                  const newSize = e.target.value as 'small' | 'medium' | 'large';
                  setSkinImageSize(newSize);
                  if (window.electronAPI) {
                    await window.electronAPI.saveConfig({ skinImageSize: newSize });
                  }
                }}
                className="setting-input"
                style={{ padding: '8px 12px', cursor: 'pointer' }}
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </div>
          </div>
        </div>

        {/* Application Settings */}
        <div className="settings-card settings-card-wide">
          <h3 className="settings-card-title">Application Settings</h3>
          <div className="settings-card-content">
            <div className="toggle-list toggle-list-row">
              <ToggleSwitch
                label="Auto-start with Windows"
                description="Automatically start the app when Windows boots up"
                checked={autoStartWithWindows}
                onChange={(checked) => handleToggleChange(checked, setAutoStartWithWindows, 'autoStartWithWindows')}
              />
              <ToggleSwitch
                label="Auto-start with Valorant"
                description={autoStartWithWindows 
                  ? "Automatically start the app when Valorant launches"
                  : "Requires 'Auto-start with Windows' to be enabled"}
                checked={autoStartWithValorant}
                onChange={(checked) => handleToggleChange(checked, setAutoStartWithValorant, 'autoStartWithValorant')}
                disabled={!autoStartWithWindows}
              />
            </div>
          </div>
        </div>

        {/* Display Options */}
        <div className="settings-card settings-card-wide">
          <h3 className="settings-card-title">Display Options</h3>
          <p className="setting-description" style={{ marginBottom: '24px' }}>Toggle which statistics to display in the match view</p>
          <div className="toggle-list">
            <ToggleSwitch
              label="KD"
              description="Kill/Death ratio"
              checked={showKD}
              onChange={(checked) => handleToggleChange(checked, setShowKD, 'showKD')}
            />
            <ToggleSwitch
              label="HS%"
              description="Headshot percentage"
              checked={showHS}
              onChange={(checked) => handleToggleChange(checked, setShowHS, 'showHS')}
            />
            <ToggleSwitch
              label="WR%"
              description="Win rate percentage"
              checked={showWR}
              onChange={(checked) => handleToggleChange(checked, setShowWR, 'showWR')}
            />
            <ToggleSwitch
              label="ΔRR"
              description="Ranked rating change"
              checked={showRR}
              onChange={(checked) => handleToggleChange(checked, setShowRR, 'showRR')}
            />
            <ToggleSwitch
              label="Skin"
              description="Weapon skin display"
              checked={showSkin}
              onChange={(checked) => handleToggleChange(checked, setShowSkin, 'showSkin')}
            />
            <ToggleSwitch
              label="Rank"
              description="Current competitive rank"
              checked={showRank}
              onChange={(checked) => handleToggleChange(checked, setShowRank, 'showRank')}
            />
            <ToggleSwitch
              label="Peak Rank"
              description="Highest rank achieved"
              checked={showPeak}
              onChange={(checked) => handleToggleChange(checked, setShowPeak, 'showPeak')}
            />
            <ToggleSwitch
              label="Level"
              description="Account level"
              checked={showLevel}
              onChange={(checked) => handleToggleChange(checked, setShowLevel, 'showLevel')}
            />
            <ToggleSwitch
              label="Party Icons"
              description="Show party member indicators"
              checked={showParty}
              onChange={(checked) => handleToggleChange(checked, setShowParty, 'showParty')}
            />
            <ToggleSwitch
              label="Leaderboard Position"
              description="Show leaderboard rank for Immortal/Radiant players"
              checked={showLeaderboard}
              onChange={(checked) => handleToggleChange(checked, setShowLeaderboard, 'showLeaderboard')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

