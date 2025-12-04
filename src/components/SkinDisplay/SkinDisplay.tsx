import { useState } from 'react';
import './SkinDisplay.css';

interface SkinData {
  skinName: string;
  skinVariant?: string;
  skinLevel?: string;
  skinImageUrl?: string;
}

interface SkinDisplayProps {
  skinData: SkinData;
  gun: string;
  size?: 'small' | 'medium' | 'large';
}

export function SkinDisplay({ skinData, gun, size = 'medium' }: SkinDisplayProps) {
  const [imageError, setImageError] = useState(false);
  
  // Reset error state when gun or skinData changes to allow new image to load
  // Use a key on the image element instead of useEffect to reset state
  const imageKey = `${gun}-${skinData?.skinImageUrl || skinData?.skinName || ''}`;
  
  // Skin data logging removed
  
  // Use API image URL if available, otherwise fallback to local assets
  const getImageSrc = () => {
    // If we have an API image URL, use it
    if (skinData?.skinImageUrl) {
      return skinData.skinImageUrl;
    }
    
    // Fallback to local assets for Standard skin
    if (!skinData || !skinData.skinName || !skinData.skinName.trim()) {
      return null;
    }
    
    const skinName = skinData.skinName.trim();
    const gunLower = gun.toLowerCase();
    
    if (skinName.toLowerCase() === 'standard') {
      return `/assets/guns/${gunLower}/Standard.png`;
    }
    
    return null;
  };
  
  const imageSrc = getImageSrc();
  
  // Render image if we have a valid source
  if (imageSrc && !imageError) {
    return (
      <div className={`player-skin-container player-skin-${size}`}>
        <img
          key={imageKey}
          src={imageSrc}
          alt={skinData.skinName}
          className={`player-skin-image player-skin-image-${size}`}
          onError={() => {
            setImageError(true);
          }}
          onLoad={() => {
            setImageError(false);
          }}
        />
      </div>
    );
  }
  
  // Show text fallback
  return (
    <div className="player-skin-container">
      <div className="player-skin-name" title={skinData?.skinName || 'No skin'}>
        {skinData?.skinName || 'No skin'}
      </div>
    </div>
  );
}

