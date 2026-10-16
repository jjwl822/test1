package com.family.messenger.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.family.messenger.FamilyApp
import com.family.messenger.data.Api
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(app: FamilyApp) {
    var isRegister by rememberSaveable { mutableStateOf(false) }
    var server by rememberSaveable { mutableStateOf(app.session.lastServerUrl) }
    var familyCode by rememberSaveable { mutableStateOf("") }
    var username by rememberSaveable { mutableStateOf("") }
    var displayName by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    var busy by rememberSaveable { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun submit() {
        error = null
        busy = true
        scope.launch {
            try {
                val url = Api.normalize(server)
                val response = if (isRegister) {
                    app.api.register(url, familyCode.trim(), username.trim(), displayName.trim(), password)
                } else {
                    app.api.login(url, username.trim(), password)
                }
                app.session.save(url, response)
            } catch (e: Exception) {
                error = e.message ?: "오류가 발생했습니다."
            } finally {
                busy = false
            }
        }
    }

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .systemBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Spacer(Modifier.height(24.dp))
            Text("가족 메신저", style = MaterialTheme.typography.headlineLarge, color = MaterialTheme.colorScheme.primary)
            Text("우리 가족끼리만 쓰는 대화방", style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(8.dp))

            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                SegmentedButton(
                    selected = !isRegister,
                    onClick = { isRegister = false },
                    shape = SegmentedButtonDefaults.itemShape(0, 2),
                ) { Text("로그인") }
                SegmentedButton(
                    selected = isRegister,
                    onClick = { isRegister = true },
                    shape = SegmentedButtonDefaults.itemShape(1, 2),
                ) { Text("가입하기") }
            }

            OutlinedTextField(
                value = server,
                onValueChange = { server = it },
                label = { Text("서버 주소") },
                placeholder = { Text("예: family.uhoui.com") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
            if (isRegister) {
                OutlinedTextField(
                    value = familyCode,
                    onValueChange = { familyCode = it },
                    label = { Text("가족 코드") },
                    supportingText = { Text("서버를 설치한 가족에게 받은 코드") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = displayName,
                    onValueChange = { displayName = it },
                    label = { Text("이름 (예: 엄마, 아빠, 민수)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            OutlinedTextField(
                value = username,
                onValueChange = { username = it },
                label = { Text("아이디") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("비밀번호") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )

            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

            Button(
                onClick = ::submit,
                enabled = !busy && server.isNotBlank() && username.isNotBlank() && password.isNotBlank() &&
                    (!isRegister || (familyCode.isNotBlank() && displayName.isNotBlank())),
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                if (busy) CircularProgressIndicator(Modifier.height(24.dp), strokeWidth = 2.dp)
                else Text(if (isRegister) "가입하고 시작하기" else "로그인")
            }
        }
    }
}
