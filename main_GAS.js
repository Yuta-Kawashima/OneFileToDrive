// ファイル共有時にまずこの関数が呼ばれる
function doPost(e){
    var params = JSON.parse(e.postData.getDataAsString());
    var res = {};
    // 初回の認証時のみ必要
    if(params.type === "url_verification"){
      return ContentService.createTextOutput(params.challenge);
    }else if(params.type === 'event_callback'){
      console.log(params);
      if(!eventIdProceeded(params.event_id)){
          moveFiles(params);  // ファイルをgoogle driveに移す
      }
    return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
    }
    /*
    else if(params.event.type === "file_shared") {
      moveFiles(params);  // ファイルをgoogle driveに移す
    }
    */
  
    return ContentService.createTextOutput('ok');
  }
  
  function eventIdProceeded(eventId){
    var prevEventId = CacheService.getScriptCache().get(eventId);
    if(prevEventId){
      return true;
    }else{
      CacheService.getScriptCache().put(eventId,'proceeded', 60*5);
      return false;
    }
  }
  
  
  // ファイルをgoogle driveに移す
  function moveFiles(params){
    // google driveに移したくないファイル形式
    // https://api.slack.com/types/file を参考に適宜追加する
    var notCopyType = [];
  
    // tokenとアップロード先のGoogle DriveのフォルダIDを取得
    // それぞれ「ファイル > プロジェクトのプロパティ > スクリプトのプロパティ」から登録しておくこと
    var scriptProperties = PropertiesService.getScriptProperties();
    var slackAccessToken = scriptProperties.getProperty("TOKEN");
    var folderId = scriptProperties.getProperty("FOLDER_ID");
  
    try{          
      // File ID取得
      var fileId = params.event.file_id;
      // ユーザID取得
      var userId = params.event.user_id;
      var userResponse = UrlFetchApp.fetch('https://slack.com/api/users.info?token='+slackAccessToken+'&user='+userId);
      var userInfo = JSON.parse(userResponse.getContentText());
      // アップロード先のフォルダ名に使用する
      var userName = userInfo.user.name;
      // リンクをSlackに貼り直す際のコメントに使用する
      var displayName = userInfo.user.profile.display_name;
      if (displayName === "") {
        displayName = userInfo.user.profile.real_name;
      }
  
      // File詳細取得
      var fileResponse = UrlFetchApp.fetch('https://slack.com/api/files.info?token='+slackAccessToken+'&file='+fileId);
      var fileInfo = JSON.parse(fileResponse.getContentText());
  
      // Google Driveのリンクなら無視
      if(fileInfo.file.external_type == 'gdrive'){
        return;
      }
  
      // 50MB以上なら終了(GASは50MB以上のファイルを一度に扱えません)
      if(fileInfo.file.size > 50000000){
        return;
      }
  
      // ダウンロード用URL
      var dlUrl = fileInfo.file.url_private;
      // ファイル形式
      var fileType = fileInfo.file.filetype;
  
      // Google Driveに移したくないファイル形式の場合は何もしない
      for(i in notCopyType) {
        if(fileType == notCopyType[i]){
          return;
        }
      }
  
      // Slackからファイル取得
      var headers = {
        "Authorization" : "Bearer " + slackAccessToken
      };    
      var params2 = {
        "method":"GET",
        "headers":headers
      };
      var dlData = UrlFetchApp.fetch(dlUrl, params2).getBlob();
  
      /////////////////////////////////////////////////////
      // Google Driveにファイルをアップロードする処理
      /////////////////////////////////////////////////////
  
      // フォルダを指定
      var rootFolder = DriveApp.getFolderById(folderId);
      /*
      // ユーザ名の入ったフォルダに移動
      var targetFolder = rootFolder.getFoldersByName(userName +"_slackItems");
      // 対象フォルダがない場合は新しく作成
      if(targetFolder.hasNext() == false){
        var targetFolderId = rootFolder.createFolder(userName +"_slackItems");
      } else {
        var targetFolderId = DriveApp.getFolderById(targetFolder.next().getId());
      }
      */
  
      // Slackからダウンロードしたファイル名の文字化け対策
      dlData.setName(fileInfo.file.name);
  
      // Google Driveにファイルをアップロード
      //var driveFile = targetFolderId.createFile(dlData);
      var driveFile = rootFolder.createFile(dlData);
  
      // 共有設定 (リンクを知っていれば閲覧可)
      driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  
      // おまじない
      Utilities.sleep(100);
  
      /////////////////////////////////////////////////////
      // Slackにリンクを貼る処理
      /////////////////////////////////////////////////////
  
      // ファイルをどのチャンネルにシェアしたか特定する
      var shares = fileInfo.file.shares;
  
      // publicチャンネルの場合のkeyはpublicだが、
      // この書き方ならprivateチャンネルに共有された場合でも対応可能
      for(key in shares){
        foo=shares[key];
        postType = key;
        break;
      }
  
      // channel IDを取得
      for(key in foo){
        bar=foo[key];
        channelId = key;
        break;
      }
  
      // タイムスタンプを取得
      var th_ts = 0.0;
      var ts = 0.0;
      for(key in bar[0]){
        // スレッドへの投稿のタイムスタンプ
        if(key == "thread_ts"){
          th_ts = bar[0][key];
          continue;
        }
        // 通常の投稿のタイムスタンプ
        if(key == "ts"){
          ts = bar[0][key];
        }
      }
  
      // ポストするメッセージ
      var message_URL = displayName + 'さんが '+ fileInfo.file.name + ' を共有しました！\n' + driveFile.getUrl();
  
  
      // ファイルのコメントを取得する
      if(ts != 0.0){
        var historyResponse = UrlFetchApp.fetch('https://slack.com/api/groups.history?token='+slackAccessToken+'&channel=YourChannelID'+'&count=1&latest='+ts+'&oldest='+ts+'&inclusive=true');
        var historyInfo= historyResponse.getContentText();
        var historyInfo = JSON.parse(historyResponse)['messages'][0]["text"];
        var message = message_URL + '\n\n' + historyInfo;
  
        // コメント文を消去
        var delparams = {
          'token': slackAccessToken,
          'channel': channelId,
          'ts': ts,
          'as_user': false
        };
        var deloptions = {
          'method': 'POST',
          'payload': delparams
        };
        UrlFetchApp.fetch('https://slack.com/api/chat.delete',deloptions);
      }
  
      if(th_ts != 0.0){
        // スレッドにリンクを貼り直す
        postText(slackAccessToken, channelId, message, th_ts);
      }else{
        // 通常の発言としてリンクを貼り直す
        postText(slackAccessToken, channelId, message);
      }
  
      /////////////////////////////////////////////////////
      // Slack上のファイルを削除
      /////////////////////////////////////////////////////
  
      // 元ファイルを削除
      var params = {
        'token': slackAccessToken,
        'file' : fileId
      };
      var options = {
        'method': 'POST',
        'payload': params
      };
      // 削除実行
      var res = UrlFetchApp.fetch('https://slack.com/api/files.delete',options);
    }catch(e){
      // エラー内容を投稿
       postText(slackAccessToken, channelId,'Error: '+e);
    }
  }
  // メッセージをポストする
  function postText (token, channel, txt, th_ts) {
    if (th_ts == undefined){
      // 通常のポスト
      var params = {
        'token': token,
        'channel': channel,
        'text': txt,
        'as_user': false
      };
    } else {
      // スレッドへのポスト
      var params = {
        'token': token,
        'channel': channel,
        'text': txt,
        'as_user': false,
        'thread_ts':th_ts
      };
    }
    var options = {
      'method': 'POST',
      "contentType" : "application/json",
      'payload': params,
      //JSON形式に囲ってあげないとPOSTMessageが動作しないらしい。
    };
    var postUrl = 'https://slack.com/api/chat.postMessage';
    var hookUrl = 'https://hooks.slack.com/services/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';
    var hookOptions = {
      'method': 'POST',
      "contentType" : "application/json",
      'payload':JSON.stringify(params),
    };
    UrlFetchApp.fetch(hookUrl, hookOptions);
  }
  