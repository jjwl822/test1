package com.family.messenger

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.decode.VideoFrameDecoder
import com.family.messenger.data.Api
import com.family.messenger.data.Session
import com.family.messenger.service.Notifications

class FamilyApp : Application(), ImageLoaderFactory {

    lateinit var session: Session
        private set
    lateinit var api: Api
        private set

    override fun onCreate() {
        super.onCreate()
        session = Session(this)
        api = Api(session)
        Notifications.createChannels(this)
    }

    // Images are only served to logged-in family members, so Coil uses our authenticated client.
    // The video decoder shows thumbnails of videos picked from the phone before upload.
    override fun newImageLoader(): ImageLoader =
        ImageLoader.Builder(this)
            .okHttpClient(api.client)
            .components { add(VideoFrameDecoder.Factory()) }
            .crossfade(true)
            .build()
}
