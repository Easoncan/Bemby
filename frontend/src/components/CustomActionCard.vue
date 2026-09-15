<!-- One step of a custom action chain. Shared by the chain editor and the finally editor, and
     by the jobs view and the templates view, which is why everything it needs arrives as a
     prop or an emit rather than being read from the surrounding view. -->
<template>
  <div class="custom-action-card">
    <div class="custom-action-header">
      <span class="custom-action-num">{{ index + 1 }}</span>
      <select v-model="action.type" class="form-select custom-action-type-select">
        <option value="send_command">{{ t('jobs.custom.actionSendCommand') }}</option>
        <option value="send_contact_message">{{ t('jobs.custom.actionSendContactMessage') }}</option>
        <option value="wait_reply">{{ t('jobs.custom.actionWaitReply') }}</option>
        <option value="delay">{{ t('jobs.custom.actionDelay') }}</option>
        <option value="click_button">{{ t('jobs.custom.actionClickButton') }}</option>
        <option value="click_message_button">{{ t('jobs.custom.actionClickMessageButton') }}</option>
        <option value="ai_multiple_btn" :disabled="aiKeyMissing">{{ t('jobs.custom.actionAiMultipleBtn') }}{{ aiKeyMissing ? ' (' + t('jobs.noApiKey') + ')' : '' }}</option>
        <option value="enter_captcha" :disabled="aiKeyMissing">{{ t('jobs.custom.actionEnterCaptcha') }}{{ aiKeyMissing ? ' (' + t('jobs.noApiKey') + ')' : '' }}</option>
        <option value="join_group">{{ t('jobs.custom.actionJoinGroup') }}</option>
        <option value="subscribe_channel">{{ t('jobs.custom.actionSubscribeChannel') }}</option>
        <option value="update_profile">{{ t('jobs.custom.actionUpdateProfile') }}</option>
        <option value="open_mini_app" :disabled="cfBrowserMissing">{{ t('jobs.custom.actionOpenMiniApp') }}{{ cfBrowserMissing ? ' (' + t('jobs.noCfBrowser') + ')' : '' }}</option>
        <option value="open_mini_app_url" :disabled="cfBrowserMissing">{{ t('jobs.custom.actionOpenMiniAppUrl') }}{{ cfBrowserMissing ? ' (' + t('jobs.noCfBrowser') + ')' : '' }}</option>
        <option value="open_bot_menu_app" :disabled="cfBrowserMissing">{{ t('jobs.custom.actionOpenBotMenuApp') }}{{ cfBrowserMissing ? ' (' + t('jobs.noCfBrowser') + ')' : '' }}</option>
        <option value="open_url" :disabled="cfBrowserMissing">{{ t('jobs.custom.actionOpenUrl') }}{{ cfBrowserMissing ? ' (' + t('jobs.noCfBrowser') + ')' : '' }}</option>
      </select>
      <button type="button" class="btn btn-ghost btn-sm btn-icon" :disabled="index === 0" @click="emit('moveUp')"><i class="fa-solid fa-arrow-up"></i></button>
      <button type="button" class="btn btn-ghost btn-sm btn-icon" :disabled="index === count - 1" @click="emit('moveDown')"><i class="fa-solid fa-arrow-down"></i></button>
      <button type="button" class="btn btn-danger btn-sm btn-icon" @click="emit('remove')"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <!-- send_command -->
    <div v-if="action.type === 'send_command'" class="custom-action-params">
      <div class="form-row" style="margin-bottom:0">
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelContent') }}</label>
          <select v-model="action.contentDropdown" class="form-select">
            <option value="/start">/start</option>
            <option value="/checkin">/checkin</option>
            <option value="{aiInput}" :disabled="aiKeyMissing">{{ t('jobs.aiInputOption') }}{{ aiKeyMissing ? ' (' + t('jobs.noApiKey') + ')' : '' }}</option>
            <option value="custom">{{ t('common.custom') }}...</option>
          </select>
          <input v-if="action.contentDropdown === 'custom'" v-model="action.contentCustom" class="form-input" style="margin-top:6px" placeholder="/mycommand" />
          <template v-if="action.contentDropdown === '{aiInput}'">
            <input v-model.trim="action.contentAiInputLength" class="form-input" style="margin-top:6px" type="number" min="1" max="20" :placeholder="t('jobs.aiInputLengthPlaceholder')" />
            <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.aiInputLengthHint') }}</div>
            <div v-if="aiKeyMissing" style="font-size:11px;color:#e63946;margin-top:4px">{{ t('jobs.aiKeyWarning') }}</div>
          </template>
          <div v-else style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.contentHint') }}</div>
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelMaxRetries') }}</label>
          <input v-model.number="action.maxRetries" class="form-input" type="number" min="1" max="10" />
        </div>
      </div>
    </div>

    <!-- send_contact_message -->
    <div v-if="action.type === 'send_contact_message'" class="custom-action-params">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.custom.labelContact') }}</label>
        <input v-model.trim="action.contact" class="form-input" :placeholder="t('jobs.custom.contactPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.contactHint') }}</div>
      </div>
      <div class="form-row" style="margin-bottom:0;margin-top:8px">
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelContent') }}</label>
          <select v-model="action.contentDropdown" class="form-select">
            <option value="/start">/start</option>
            <option value="/checkin">/checkin</option>
            <option value="{aiInput}" :disabled="aiKeyMissing">{{ t('jobs.aiInputOption') }}{{ aiKeyMissing ? ' (' + t('jobs.noApiKey') + ')' : '' }}</option>
            <option value="custom">{{ t('common.custom') }}...</option>
          </select>
          <input v-if="action.contentDropdown === 'custom'" v-model="action.contentCustom" class="form-input" style="margin-top:6px" placeholder="/mycommand" />
          <template v-if="action.contentDropdown === '{aiInput}'">
            <input v-model.trim="action.contentAiInputLength" class="form-input" style="margin-top:6px" type="number" min="1" max="20" :placeholder="t('jobs.aiInputLengthPlaceholder')" />
            <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.aiInputLengthHint') }}</div>
            <div v-if="aiKeyMissing" style="font-size:11px;color:#e63946;margin-top:4px">{{ t('jobs.aiKeyWarning') }}</div>
          </template>
          <div v-else style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.contentHint') }}</div>
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelMaxRetries') }}</label>
          <input v-model.number="action.maxRetries" class="form-input" type="number" min="1" max="10" />
        </div>
      </div>
    </div>

    <!-- wait_reply -->
    <div v-if="action.type === 'wait_reply'" class="custom-action-params">
      <div class="form-row" style="margin-bottom:0">
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelMaxWait') }}</label>
          <input v-model.number="action.maxWaitMs" class="form-input" type="number" min="1000" step="1000" />
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelMaxRetries') }}</label>
          <input v-model.number="action.maxRetries" class="form-input" type="number" min="1" max="10" />
        </div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.custom.labelScope') }}</label>
        <input v-model.number="action.scope" class="form-input" type="number" max="0" step="1" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.scopeHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.custom.labelSuccessContains') }}</label>
        <input v-model.trim="action.successContains" class="form-input" :placeholder="t('jobs.custom.successContainsPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.successContainsHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.custom.labelFailContains') }}</label>
        <input v-model.trim="action.failContains" class="form-input" :placeholder="t('jobs.custom.failContainsPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.failContainsHint') }}</div>
      </div>
    </div>

    <!-- delay -->
    <div v-if="action.type === 'delay'" class="custom-action-params">
      <label class="form-label">{{ t('jobs.custom.labelWaitMs') }}</label>
      <input v-model.number="action.waitMs" class="form-input" type="number" min="100" step="500" />
    </div>

    <!-- click_button -->
    <div v-if="action.type === 'click_button'" class="custom-action-params">
      <div class="form-row" style="margin-bottom:0">
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelButton') }}</label>
          <select v-model="action.buttonDropdown" class="form-select">
            <option value="签到">签到</option>
            <option value="{aiBtn}" :disabled="aiKeyMissing">{{ t('jobs.aiBtnOption') }}{{ aiKeyMissing ? ' (' + t('jobs.noApiKey') + ')' : '' }}</option>
            <option value="{anyBtn}">{{ t('jobs.anyBtnOption') }}</option>
            <option value="custom">{{ t('common.custom') }}...</option>
          </select>
          <input v-if="action.buttonDropdown === 'custom'" v-model="action.buttonCustom" class="form-input" style="margin-top:6px" placeholder="Custom button text" />
          <template v-if="action.buttonDropdown === '{aiBtn}'">
            <input v-model.trim="action.buttonAiHint" class="form-input" style="margin-top:6px" :placeholder="t('jobs.aiHintPlaceholder')" />
            <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.aiHintHint') }}</div>
            <div v-if="aiKeyMissing" style="font-size:11px;color:#e63946;margin-top:4px">{{ t('jobs.aiKeyWarning') }}</div>
          </template>
          <div v-else style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.buttonHint') }}</div>
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelMaxRetries') }}</label>
          <input v-model.number="action.maxRetries" class="form-input" type="number" min="1" max="10" />
        </div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.custom.labelMaxWait') }}</label>
        <input v-model.number="action.maxWaitMs" class="form-input" type="number" min="1000" step="1000" />
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.custom.labelScope') }}</label>
        <input v-model.number="action.scope" class="form-input" type="number" max="0" step="1" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.scopeHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.custom.labelSuccessContains') }}</label>
        <input v-model.trim="action.successContains" class="form-input" :placeholder="t('jobs.custom.successContainsPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.successContainsHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.custom.labelFailContains') }}</label>
        <input v-model.trim="action.failContains" class="form-input" :placeholder="t('jobs.custom.failContainsPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.failContainsHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0;margin-top:8px">
        <label class="form-checkbox-label">
          <input type="checkbox" v-model="action.cfChallenge" :disabled="cfBrowserMissing" />
          {{ t('jobs.custom.labelCfChallenge') }}
        </label>
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.cfChallengeHint') }}</div>
        <div v-if="cfBrowserMissing" style="font-size:11px;color:#e63946;margin-top:4px">{{ t('jobs.cfBrowserWarning') }}</div>
      </div>
    </div>

    <!-- click_message_button -->
    <div v-if="action.type === 'click_message_button'" class="custom-action-params">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.custom.labelContact') }}</label>
        <input v-model.trim="action.contact" class="form-input" :placeholder="t('jobs.custom.contactPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.contactHint') }}</div>
      </div>
      <div class="form-row" style="margin-bottom:0;margin-top:8px">
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelButton') }}</label>
          <select v-model="action.buttonDropdown" class="form-select">
            <option value="签到">签到</option>
            <option value="{aiBtn}" :disabled="aiKeyMissing">{{ t('jobs.aiBtnOption') }}{{ aiKeyMissing ? ' (' + t('jobs.noApiKey') + ')' : '' }}</option>
            <option value="{anyBtn}">{{ t('jobs.anyBtnOption') }}</option>
            <option value="custom">{{ t('common.custom') }}...</option>
          </select>
          <input v-if="action.buttonDropdown === 'custom'" v-model="action.buttonCustom" class="form-input" style="margin-top:6px" placeholder="Custom button text" />
          <template v-if="action.buttonDropdown === '{aiBtn}'">
            <input v-model.trim="action.buttonAiHint" class="form-input" style="margin-top:6px" :placeholder="t('jobs.aiHintPlaceholder')" />
            <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.aiHintHint') }}</div>
            <div v-if="aiKeyMissing" style="font-size:11px;color:#e63946;margin-top:4px">{{ t('jobs.aiKeyWarning') }}</div>
          </template>
          <div v-else style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.buttonHint') }}</div>
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelMaxRetries') }}</label>
          <input v-model.number="action.maxRetries" class="form-input" type="number" min="1" max="10" />
        </div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.custom.labelMaxWait') }}</label>
        <input v-model.number="action.maxWaitMs" class="form-input" type="number" min="1000" step="1000" />
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.custom.labelScope') }}</label>
        <input v-model.number="action.scope" class="form-input" type="number" max="0" step="1" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.scopeHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.custom.labelSuccessContains') }}</label>
        <input v-model.trim="action.successContains" class="form-input" :placeholder="t('jobs.custom.successContainsPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.successContainsHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.custom.labelFailContains') }}</label>
        <input v-model.trim="action.failContains" class="form-input" :placeholder="t('jobs.custom.failContainsPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.failContainsHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0;margin-top:8px">
        <label class="form-checkbox-label">
          <input type="checkbox" v-model="action.cfChallenge" :disabled="cfBrowserMissing" />
          {{ t('jobs.custom.labelCfChallenge') }}
        </label>
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.cfChallengeHint') }}</div>
        <div v-if="cfBrowserMissing" style="font-size:11px;color:#e63946;margin-top:4px">{{ t('jobs.cfBrowserWarning') }}</div>
      </div>
    </div>


    <!-- ai_multiple_btn -->
    <div v-if="action.type === 'ai_multiple_btn'" class="custom-action-params">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.custom.labelContactOptional') }}</label>
        <input v-model.trim="action.contact" class="form-input" :placeholder="t('jobs.custom.contactOptionalPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.contactOptionalHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0;margin-top:8px">
        <label class="form-label">{{ t('jobs.aiHintLabel') }}</label>
        <input v-model.trim="action.buttonAiHint" class="form-input" :placeholder="t('jobs.aiHintPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.aiMultipleBtnHint') }}</div>
        <div v-if="aiKeyMissing" style="font-size:11px;color:#e63946;margin-top:4px">{{ t('jobs.aiKeyWarning') }}</div>
      </div>
      <div class="form-row" style="margin-bottom:0;margin-top:8px">
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelGapMs') }}</label>
          <input v-model.number="action.gapMs" class="form-input" type="number" min="0" step="500" />
          <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.gapMsHint') }}</div>
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelMaxRetries') }}</label>
          <input v-model.number="action.maxRetries" class="form-input" type="number" min="1" max="10" />
        </div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.custom.labelMaxWait') }}</label>
        <input v-model.number="action.maxWaitMs" class="form-input" type="number" min="1000" step="1000" />
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.custom.labelScope') }}</label>
        <input v-model.number="action.scope" class="form-input" type="number" max="0" step="1" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.scopeHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.custom.labelSuccessContains') }}</label>
        <input v-model.trim="action.successContains" class="form-input" :placeholder="t('jobs.custom.successContainsPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.successContainsHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.custom.labelFailContains') }}</label>
        <input v-model.trim="action.failContains" class="form-input" :placeholder="t('jobs.custom.failContainsPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.failContainsHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0;margin-top:8px">
        <label class="form-checkbox-label">
          <input type="checkbox" v-model="action.cfChallenge" :disabled="cfBrowserMissing" />
          {{ t('jobs.custom.labelCfChallenge') }}
        </label>
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.cfChallengeHint') }}</div>
        <div v-if="cfBrowserMissing" style="font-size:11px;color:#e63946;margin-top:4px">{{ t('jobs.cfBrowserWarning') }}</div>
      </div>
    </div>

    <div v-if="action.type === 'enter_captcha'" class="custom-action-params">
      <div class="form-row" style="margin-bottom:0">
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelMaxWait') }}</label>
          <input v-model.number="action.maxWaitMs" class="form-input" type="number" min="1000" step="1000" />
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelCaptchaLength') }}</label>
          <input v-model.trim="action.captchaLength" class="form-input" type="number" min="1" max="20" :placeholder="t('jobs.aiInputLengthPlaceholder')" />
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelMaxRetries') }}</label>
          <input v-model.number="action.maxRetries" class="form-input" type="number" min="1" max="10" />
        </div>
      </div>
      <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.aiInputLengthHint') }}</div>
      <div v-if="aiKeyMissing" style="font-size:11px;color:#e63946;margin-top:4px">{{ t('jobs.aiKeyWarning') }}</div>
    </div>

    <!-- join_group -->
    <div v-if="action.type === 'join_group'" class="custom-action-params">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.custom.labelGroupId') }}</label>
        <input v-model.trim="action.groupId" class="form-input" :placeholder="t('jobs.custom.groupIdPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.groupIdHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0;margin-top:8px">
        <label class="form-checkbox-label">
          <input type="checkbox" v-model="action.checkMembership" />
          {{ t('jobs.custom.labelCheckMembership') }}
        </label>
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.checkMembershipHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0;margin-top:8px">
        <label class="form-label">{{ t('jobs.custom.labelVerifyButton') }}</label>
        <input v-model.trim="action.verifyButton" class="form-input" :placeholder="t('jobs.custom.verifyButtonPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.verifyButtonHint') }}</div>
      </div>
      <div v-if="action.verifyButton" class="form-group" style="margin-bottom:0;margin-top:8px">
        <label class="form-label">{{ t('jobs.custom.labelVerifyWaitMs') }}</label>
        <input v-model.number="action.verifyWaitMs" type="number" min="1000" step="1000" class="form-input" />
      </div>
    </div>

    <!-- subscribe_channel -->
    <div v-if="action.type === 'subscribe_channel'" class="custom-action-params">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.custom.labelChannelId') }}</label>
        <input v-model.trim="action.channelId" class="form-input" :placeholder="t('jobs.custom.channelIdPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.channelIdHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0;margin-top:8px">
        <label class="form-checkbox-label">
          <input type="checkbox" v-model="action.checkMembership" />
          {{ t('jobs.custom.labelCheckSubscription') }}
        </label>
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.checkSubscriptionHint') }}</div>
      </div>
    </div>

    <!-- open_mini_app / open_mini_app_url / open_bot_menu_app -->
    <div v-if="action.type === 'open_mini_app' || action.type === 'open_mini_app_url' || action.type === 'open_bot_menu_app'" class="custom-action-params">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ action.type === 'open_mini_app' ? t('jobs.custom.labelContactOptional') : action.type === 'open_mini_app_url' ? t('jobs.custom.labelMiniAppOwner') : t('jobs.custom.labelMenuAppOwner') }}</label>
        <input v-model.trim="action.contact" class="form-input" :placeholder="t('jobs.custom.contactOptionalPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ action.type === 'open_mini_app' ? t('jobs.custom.contactOptionalHint') : action.type === 'open_mini_app_url' ? t('jobs.custom.miniAppOwnerHint') : t('jobs.custom.menuAppOwnerHint') }}</div>
      </div>
      <div v-if="action.type === 'open_mini_app_url'" class="form-group" style="margin-bottom:0;margin-top:8px">
        <label class="form-label">{{ t('jobs.custom.labelMiniAppUrl') }}</label>
        <input v-model.trim="action.url" class="form-input" :placeholder="t('jobs.custom.miniAppUrlPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.miniAppUrlHint') }}</div>
      </div>
      <div v-if="action.type === 'open_mini_app'" class="form-group" style="margin-bottom:0;margin-top:8px">
        <label class="form-label">{{ t('jobs.custom.labelMiniAppButton') }}</label>
        <input v-model.trim="action.button" class="form-input" :placeholder="t('jobs.custom.miniAppButtonPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.miniAppButtonHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0;margin-top:8px">
        <label class="form-label">{{ t('jobs.custom.labelInAppButton') }}</label>
        <input v-model.trim="action.appButton" class="form-input" :placeholder="t('jobs.custom.inAppButtonPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.inAppButtonHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0;margin-top:8px">
        <label class="form-label">{{ t('jobs.custom.labelSuccessContains') }}</label>
        <input v-model.trim="action.successContains" class="form-input" :placeholder="t('jobs.custom.successContainsPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.successContainsHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0;margin-top:8px">
        <label class="form-label">{{ t('jobs.custom.labelFailContains') }}</label>
        <input v-model.trim="action.failContains" class="form-input" :placeholder="t('jobs.custom.failContainsPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.failContainsHint') }}</div>
      </div>
      <div class="form-row" style="margin-bottom:0;margin-top:8px">
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelMaxRetries') }}</label>
          <input v-model.number="action.maxRetries" class="form-input" type="number" min="1" max="10" />
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelMiniAppMaxWait') }}</label>
          <input v-model.number="action.miniAppMaxWaitMs" class="form-input" type="number" min="0" step="10000" placeholder="300000" />
        </div>
      </div>
      <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.miniAppMaxWaitHint') }}</div>
      <div class="form-group" style="margin-bottom:0;margin-top:8px">
        <label class="form-label">{{ t('jobs.custom.labelMiniAppProxy') }}</label>
        <select v-model="action.miniAppProxyId" class="form-select">
          <option value="">{{ t('jobs.custom.miniAppProxyJob') }}</option>
          <option value="direct">{{ t('jobs.custom.miniAppProxyDirect') }}</option>
          <option v-for="p in proxiesList" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.miniAppProxyHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0;margin-top:8px">
        <label class="form-checkbox-label">
          <input type="checkbox" v-model="action.miniAppTryAllProxies" />
          {{ t('jobs.custom.labelMiniAppTryAll') }}
        </label>
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.miniAppTryAllHint') }}</div>
      </div>
    </div>

    <!-- open_url -->
    <div v-if="action.type === 'open_url'" class="custom-action-params">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">{{ t('jobs.web.labelUrl') }}</label>
        <input v-model.trim="action.url" class="form-input" :placeholder="t('jobs.web.urlPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.web.urlHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0;margin-top:10px">
        <WebStepsEditor :steps="action.webSteps" :ai-key-missing="aiKeyMissing" />
      </div>
      <div class="form-group" style="margin-bottom:0;margin-top:8px">
        <label class="form-label">{{ t('jobs.custom.labelSuccessContains') }}</label>
        <input v-model.trim="action.successContains" class="form-input" :placeholder="t('jobs.custom.successContainsPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.successContainsHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0;margin-top:8px">
        <label class="form-label">{{ t('jobs.custom.labelFailContains') }}</label>
        <input v-model.trim="action.failContains" class="form-input" :placeholder="t('jobs.custom.failContainsPlaceholder')" />
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.failContainsHint') }}</div>
      </div>
      <div class="form-row" style="margin-bottom:0;margin-top:8px">
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelMaxRetries') }}</label>
          <input v-model.number="action.maxRetries" class="form-input" type="number" min="1" max="10" />
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelMiniAppMaxWait') }}</label>
          <input v-model.number="action.miniAppMaxWaitMs" class="form-input" type="number" min="0" step="10000" placeholder="300000" />
        </div>
      </div>
      <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.miniAppMaxWaitHint') }}</div>
      <div class="form-group" style="margin-bottom:0;margin-top:8px">
        <label class="form-label">{{ t('jobs.custom.labelMiniAppProxy') }}</label>
        <select v-model="action.miniAppProxyId" class="form-select">
          <option value="">{{ t('jobs.custom.miniAppProxyJob') }}</option>
          <option value="direct">{{ t('jobs.custom.miniAppProxyDirect') }}</option>
          <option v-for="p in proxiesList" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.miniAppProxyHint') }}</div>
      </div>
      <div class="form-group" style="margin-bottom:0;margin-top:8px">
        <label class="form-checkbox-label">
          <input type="checkbox" v-model="action.miniAppTryAllProxies" />
          {{ t('jobs.custom.labelMiniAppTryAll') }}
        </label>
        <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.miniAppTryAllHint') }}</div>
      </div>
    </div>

    <!-- update_profile -->
    <div v-if="action.type === 'update_profile'" class="custom-action-params">
      <div class="form-row" style="margin-bottom:0">
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelProfileAbout') }}</label>
          <input v-model="action.profileAbout" class="form-input" :placeholder="t('jobs.custom.profileAboutPlaceholder')" />
          <div style="font-size:11px;color:#aaa;margin-top:3px">{{ t('jobs.custom.profileAboutHint') }}</div>
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('jobs.custom.labelMaxRetries') }}</label>
          <input v-model.number="action.maxRetries" class="form-input" type="number" min="1" max="10" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import WebStepsEditor from './WebStepsEditor.vue';
import { t } from '../i18n';
import type { CustomActionForm } from '../composables/customActions';

defineProps<{
  action: CustomActionForm;
  index: number;
  /** How many steps there are, so the last one knows it cannot move down. */
  count: number;
  aiKeyMissing: boolean;
  cfBrowserMissing: boolean;
}>();

const emit = defineEmits<{ moveUp: []; moveDown: []; remove: [] }>();
</script>

<style scoped>
.custom-action-card {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
  background: #fafafa;
}

.custom-action-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.custom-action-num {
  min-width: 20px;
  text-align: center;
  font-size: 11px;
  font-weight: 600;
  color: #aaa;
}

.custom-action-type-select {
  flex: 1;
}

.custom-action-params {
  padding-left: 26px;
}
</style>
