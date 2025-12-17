export type Angle = {
  pitch: number
  yaw: number
  roll: number
}

export type VirtualCamera = {
  id: number
  label: string
  previewDataUrl: string
  time: number
  angle: Angle
}

export type ProjectionType = 'Equirectangular (mono)' | 'Stereoscopic SBS' | 'Stereoscopic OU' | 'Dual Fisheye (Insta360)'

export const aspectPresets = ['16:9', '9:16', '1:1', '4:3'] as const
export type AspectPreset = (typeof aspectPresets)[number] | 'Custom'
