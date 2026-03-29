// mux.js
import Mux from '@mux/mux-node';




// Inicijalizacija Mux klijenta - ISPRAVLJENA VERZIJA
const mux = new Mux({
    tokenId: process.env.MUX_TOKEN_ID,
    tokenSecret: process.env.MUX_TOKEN_SECRET
});

// Alternativna inicijalizacija ako gore ne radi
// const mux = new Mux(
//     process.env.MUX_TOKEN_ID,
//     process.env.MUX_TOKEN_SECRET
// );

/**
 * Kreira Mux upload URL za direktan upload iz browser-a
 * @param {Object} options - Opcije za upload
 * @returns {Object} Upload URL i upload ID
 */
export async function createUploadUrl(options = {}) {
    try {
        const upload = await mux.video.uploads.create({
            // Omogućava CORS za frontend
            cors_origin: process.env.FRONTEND_URL || '*',
            
            // Opciono - postavke za novi asset
            new_asset_settings: {
                playback_policy: ['public'],
                encoding_tier: 'baseline', // ili 'smart' za bolji kvalitet
                ...options.assetSettings
            },
            
            // Test mode za development
            // test: process.env.NODE_ENV !== 'production'
            //test:'production'
        });

        return {
            uploadUrl: upload.url,
            uploadId: upload.id
        };
    } catch (error) {
        console.error('Mux upload URL creation failed:', error);
        throw error;
    }
}

/**
 * Proverava status upload-a
 * @param {string} uploadId - Mux upload ID
 * @returns {Object} Status informacije
 */
export async function checkUploadStatus(uploadId) {
    try {
        const upload = await mux.video.uploads.retrieve(uploadId);
        
        return {
            status: upload.status, // 'waiting', 'asset_created', 'error', 'cancelled', 'timed_out'
            assetId: upload.asset_id,
            error: upload.error
        };
    } catch (error) {
        console.error('Mux upload status check failed:', error);
        throw error;
    }
}

/**
 * Dohvata informacije o asset-u (videu)
 * @param {string} assetId - Mux asset ID
 * @returns {Object} Asset informacije
 */
export async function getAssetInfo(assetId) {
    try {
        const asset = await mux.video.assets.retrieve(assetId);
        
        // Uzimamo prvi playback ID (obično je samo jedan za public videe)
        const playbackId = asset.playback_ids?.[0]?.id;
        
        return {
            assetId: asset.id,
            playbackId: playbackId,
            status: asset.status, // 'preparing', 'ready', 'error'
            duration: asset.duration, // u sekundama
            aspectRatio: asset.aspect_ratio,
            resolution: asset.resolution_tier,
            maxResolution: asset.max_stored_resolution,
            createdAt: asset.created_at
        };
    } catch (error) {
        console.error('Mux asset info fetch failed:', error);
        throw error;
    }
}

/**
 * Generiše thumbnail URL za video
 * @param {string} playbackId - Mux playback ID
 * @param {Object} options - Opcije za thumbnail
 * @returns {string} Thumbnail URL
 */
export function getThumbnailUrl(playbackId, options = {}) {
    const {
        time = 5, // vreme u sekundama
        width = 640,
        height = 360,
        fitMode = 'preserve' // 'preserve', 'crop', 'smartcrop', 'pad'
    } = options;
    
    return `https://image.mux.com/${playbackId}/thumbnail.jpg?time=${time}&width=${width}&height=${height}&fit_mode=${fitMode}`;
}

/**
 * Generiše playback URL za video
 * @param {string} playbackId - Mux playback ID
 * @returns {string} Playback URL
 */
export function getPlaybackUrl(playbackId) {
    return `https://stream.mux.com/${playbackId}.m3u8`;
}

/**
 * Briše asset iz Mux-a
 * @param {string} assetId - Mux asset ID
 */
export async function deleteAsset(assetId) {
    try {
        await mux.video.assets.delete(assetId);
        console.log(`Asset ${assetId} deleted from Mux`);
    } catch (error) {
        console.error('Mux asset deletion failed:', error);
        throw error;
    }
}

/**
 * Webhook handler za Mux events
 * @param {Object} webhookData - Podaci iz Mux webhook-a
 */
export async function handleMuxWebhook(webhookData) {
    const { type, data } = webhookData;
    
    switch(type) {
        case 'video.upload.asset_created':
            // Upload je završen, asset je kreiran
            console.log('Asset created:', data.asset_id);
            return { 
                event: 'asset_created',
                uploadId: data.id,
                assetId: data.asset_id 
            };
            
        case 'video.asset.ready':
            // Video je spreman za reprodukciju
            console.log('Asset ready:', data.id);
            return { 
                event: 'asset_ready',
                assetId: data.id,
                playbackIds: data.playback_ids
            };
            
        case 'video.asset.errored':
            // Greška prilikom procesiranja
            console.error('Asset error:', data);
            return {
                event: 'asset_error',
                assetId: data.id,
                errors: data.errors
            };
            
        default:
            console.log('Unhandled webhook type:', type);
            return null;
    }
}

// Test funkcija za proveru Mux konekcije
export async function testMuxConnection() {
    try {
        console.log('Testing Mux connection...');
        console.log('MUX_TOKEN_ID:', process.env.MUX_TOKEN_ID ? 'Set' : 'Not set');
        console.log('MUX_TOKEN_SECRET:', process.env.MUX_TOKEN_SECRET ? 'Set' : 'Not set');
        
        // Pokušaj da dohvatiš listu upload-ova (samo da testiraš konekciju)
        const uploads = await mux.video.uploads.list({ limit: 1 });
        console.log('Mux connection successful!');
        return true;
    } catch (error) {
        console.error('Mux connection test failed:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        return false;
    }
}