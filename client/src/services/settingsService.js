import api from './api.js';

// Public app settings (support info, payment toggle, email-availability flag)
export const getPublicSettings = () => api.get('/settings');

export const getSettings = getPublicSettings;

export default { getPublicSettings, getSettings };
