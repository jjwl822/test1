package com.family.messenger

import com.family.messenger.data.Api
import org.junit.Assert.assertEquals
import org.junit.Test

class ServerAddressTest {
    @Test
    fun webAddressesUseHttpsAndHomeAddressesHttp() {
        assertEquals("https://family.uhoui.com", Api.normalize("family.uhoui.com"))
        assertEquals("https://family.uhoui.com", Api.normalize(" family.uhoui.com/ "))
        assertEquals("http://192.168.0.10:3000", Api.normalize("192.168.0.10:3000"))
        assertEquals("http://localhost:3000", Api.normalize("localhost:3000"))
        assertEquals("http://mypc:3000", Api.normalize("mypc:3000"))
        assertEquals("http://family.uhoui.com", Api.normalize("http://family.uhoui.com"))
    }
}
