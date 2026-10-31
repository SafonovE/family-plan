<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
require dirname(__DIR__).'/src/App.php';
try {
    $app=new App();
    $action=$_GET['action']??'session';
    $reads=['session','state','export','source'];
    if (in_array($action,$reads,true)) {
        if ($_SERVER['REQUEST_METHOD']!=='GET') throw new Problem('Нужен GET-запрос.',405);
        $payload=[];
    } else {
        if ($_SERVER['REQUEST_METHOD']!=='POST') throw new Problem('Нужен POST-запрос.',405);
        if (!in_array($action,['setup','login','recover'],true)) $app->currentUser();
        $app->csrf();
        if ((int)($_SERVER['CONTENT_LENGTH']??0)>6000000) throw new Problem('Файл слишком большой. Максимум 6 МБ.',413);
        $raw=file_get_contents('php://input',false,null,0,6000001);
        if (strlen($raw)>6000000) throw new Problem('Файл слишком большой.',413);
        try { $payload=json_decode($raw,true,100,JSON_THROW_ON_ERROR); } catch (JsonException) { throw new Problem('Не удалось прочитать данные запроса.',400); }
        if (!is_array($payload)) throw new Problem('Проверьте формат запроса.',400);
    }
    echo App::json($app->dispatch($action,$payload));
} catch (Problem $e) {
    http_response_code($e->status);echo App::json(['error'=>$e->getMessage()]+$e->details);
} catch (Throwable $e) {
    error_log('Family API: '.get_class($e));
    http_response_code(500);echo json_encode(['error'=>'Сервер не смог сохранить данные. Ввод сохранён в форме; попробуйте ещё раз.'],JSON_UNESCAPED_UNICODE);
}
