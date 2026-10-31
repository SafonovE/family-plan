<?php
declare(strict_types=1);
require_once __DIR__.'/Budget.php';
require_once __DIR__.'/Source.php';

final class Problem extends RuntimeException {
    public function __construct(string $message, public int $status=422, public array $details=[]) { parent::__construct($message); }
}

final class App {
    public PDO $db;
    public array $cfg;
    private string $prefix;
    public function __construct() {
        $file=getenv('FAMILY_CONFIG') ?: dirname(__DIR__).'/private/config.php';
        if (!is_file($file)) throw new Problem('Сначала запустите настройку приложения на сервере.',503);
        $this->cfg=require $file;
        if (!is_string($this->cfg['installKey']??null) || !preg_match('/^[a-zA-Z0-9_-]{32,128}$/D',$this->cfg['installKey']) || str_contains($this->cfg['installKey'],'REPLACE')) throw new Problem('Замените пример ключа первоначальной настройки на случайный ключ в закрытом конфиге.',503);
        $this->prefix=$this->cfg['tablePrefix']??'family_';
        if (!preg_match('/^[a-zA-Z0-9_]+$/D',$this->prefix)) throw new RuntimeException('Invalid table prefix');
        if (($this->cfg['secure']??true) && ($_SERVER['HTTPS']??'')!=='on') throw new Problem('Для входа нужен адрес с HTTPS.',426);
        if (!($this->cfg['secure']??true) && !in_array($_SERVER['REMOTE_ADDR']??'',['127.0.0.1','::1'],true)) throw new Problem('Локальный режим разрешён только на этом компьютере. Для хостинга включите HTTPS в настройке.',426);
        $this->db=new PDO($this->cfg['dsn'],$this->cfg['dbUser']??'',$this->cfg['dbPassword']??'',[
            PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES=>false,
        ]);
        if ($this->sqlite()) { $this->db->exec('PRAGMA busy_timeout=5000'); $this->db->exec('PRAGMA journal_mode=WAL'); }
        $this->schema();
        $sessions=$this->cfg['privateDir'].'/sessions';
        if (!is_dir($sessions) && !mkdir($sessions,0700,true) && !is_dir($sessions)) throw new RuntimeException('Session directory');
        ini_set('session.use_strict_mode','1'); ini_set('session.use_only_cookies','1');
        ini_set('session.gc_maxlifetime','604800');
        session_save_path($sessions); session_name('family_session');
        session_set_cookie_params(['lifetime'=>0,'path'=>'/','secure'=>$this->cfg['secure']??true,'httponly'=>true,'samesite'=>'Strict']);
        session_start();
        $_SESSION['csrf']??=bin2hex(random_bytes(24));
    }
    public function sqlite(): bool { return $this->db->getAttribute(PDO::ATTR_DRIVER_NAME)==='sqlite'; }
    public function table(string $name): string { return $this->prefix.$name; }
    private function schema(): void {
        $long=$this->sqlite()?'TEXT':'LONGTEXT'; $engine=$this->sqlite()?'':' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        $this->db->exec('CREATE TABLE IF NOT EXISTS '.$this->table('users')." (id VARCHAR(40) PRIMARY KEY, login VARCHAR(64) NOT NULL UNIQUE, name VARCHAR(100) NOT NULL, password VARCHAR(255) NOT NULL, recovery VARCHAR(255) NOT NULL, auth_version INTEGER NOT NULL DEFAULT 1)".$engine);
        $this->db->exec('CREATE TABLE IF NOT EXISTS '.$this->table('budget')." (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, body $long NOT NULL)".$engine);
        $this->db->exec('CREATE TABLE IF NOT EXISTS '.$this->table('requests')." (user_id VARCHAR(40) NOT NULL, request_id VARCHAR(80) NOT NULL, payload_hash VARCHAR(64) NOT NULL, body $long NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(user_id,request_id))".$engine);
        $this->db->exec('CREATE TABLE IF NOT EXISTS '.$this->table('attempts')." (id VARCHAR(64) PRIMARY KEY, tries INTEGER NOT NULL, expires INTEGER NOT NULL)".$engine);
        $sql=$this->sqlite()?'INSERT OR IGNORE':'INSERT IGNORE';
        $q=$this->db->prepare($sql.' INTO '.$this->table('budget').' (id,revision,body) VALUES (1,0,?)');
        $q->execute([self::json(self::emptyBudget())]);
    }
    public static function emptyBudget(): array { return ['categories'=>[],'entries'=>[],'plans'=>[],'months'=>[],'templates'=>[],'imports'=>[],'history'=>[]]; }
    public static function json(mixed $v): string { return json_encode($v,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR); }
    public static function id(): string { return bin2hex(random_bytes(12)); }
    public static function str(mixed $v,int $max=200,bool $required=true): string {
        if (!is_string($v) || strlen($v)>$max*4 || preg_match('//u',$v)!==1 || preg_match_all('/./us',$v)>$max || ($required && trim($v)==='')) throw new Problem('Проверьте текстовое поле: максимум '.$max.' символов.');
        return trim($v);
    }
    public function begin(): void { if ($this->sqlite()) $this->db->exec('BEGIN IMMEDIATE'); else $this->db->beginTransaction(); }
    public function commit(): void { if ($this->sqlite()) $this->db->exec('COMMIT'); else $this->db->commit(); }
    public function rollback(): void { try { if ($this->sqlite()) $this->db->exec('ROLLBACK'); elseif ($this->db->inTransaction()) $this->db->rollBack(); } catch(Throwable) {} }
    public function initialized(): bool { return (int)$this->db->query('SELECT COUNT(*) FROM '.$this->table('users'))->fetchColumn()>0; }
    public function currentUser(bool $required=true): ?array {
        $u=null;
        if (isset($_SESSION['uid'])) {
            $q=$this->db->prepare('SELECT id,login,name,auth_version FROM '.$this->table('users').' WHERE id=?');$q->execute([$_SESSION['uid']]);$u=$q->fetch()?:null;
            if (!$u || (int)$u['auth_version']!==($_SESSION['version']??0) || time()-($_SESSION['seen']??0)>604800) { unset($_SESSION['uid'],$_SESSION['version']);$u=null; }
            else { $_SESSION['seen']=time(); unset($u['auth_version']); }
        }
        if (!$u && $required) throw new Problem('Войдите в общий бюджет.',401);
        return $u;
    }
    public function csrf(): void {
        if (!hash_equals($_SESSION['csrf'],$_SERVER['HTTP_X_CSRF_TOKEN']??'')) throw new Problem('Сессия обновилась. Обновите страницу и повторите действие.',403);
        if (isset($_SERVER['HTTP_SEC_FETCH_SITE']) && $_SERVER['HTTP_SEC_FETCH_SITE']==='cross-site') throw new Problem('Недопустимый источник запроса.',403);
    }
    private static function password(mixed $password): string {
        if (!is_string($password) || strlen($password)<12 || strlen($password)>72) throw new Problem('Пароль должен содержать от 12 до 72 байт (латинский символ — 1 байт).');
        return $password;
    }
    private static function login(mixed $v): string {
        if (!is_string($v) || !preg_match('/^[a-zA-Z0-9_.-]{3,40}$/D',$v)) throw new Problem('Логин: 3–40 латинских букв, цифр, точек, дефисов или знаков _.');
        return strtolower($v);
    }
    private static function recovery(): string { return implode('-',str_split(strtoupper(bin2hex(random_bytes(16))),8)); }
    public function setup(array $p): array {
        if (!hash_equals($this->cfg['installKey'],is_string($p['installKey']??null)?$p['installKey']:'')) throw new Problem('Неверный ключ первоначальной настройки.',403);
        $users=$p['users']??[];
        $this->begin();
        try {
            $this->db->query('SELECT id FROM '.$this->table('budget').' WHERE id=1'.($this->sqlite()?'':' FOR UPDATE'))->fetch();
            if ($this->initialized()) throw new Problem('Два пользователя уже настроены.',409);
            if (!is_array($users) || count($users)!==2) throw new Problem('Нужно создать два отдельных входа.');
            $q=$this->db->prepare('INSERT INTO '.$this->table('users').' (id,login,name,password,recovery,auth_version) VALUES (?,?,?,?,?,1)'); $codes=[];$logins=[];
            foreach ($users as $u) {
                $login=self::login($u['login']??null); if (in_array($login,$logins,true)) throw new Problem('Выберите разные логины.'); $logins[]=$login;
                $code=self::recovery();$q->execute([self::id(),$login,self::str($u['name']??null,50),password_hash(self::password($u['password']??null),PASSWORD_DEFAULT),password_hash($code,PASSWORD_DEFAULT)]);
                $codes[]=['login'=>$login,'code'=>$code];
            }
            $this->commit();return ['recoveryCodes'=>$codes];
        } catch (Throwable $e) { $this->rollback();throw $e; }
    }
    private function throttle(string $login): string {
        $id=hash('sha256',($_SERVER['REMOTE_ADDR']??'unknown').'|'.$login);$now=time();
        $sql=$this->sqlite()?'INSERT OR IGNORE':'INSERT IGNORE';$q=$this->db->prepare($sql.' INTO '.$this->table('attempts').' (id,tries,expires) VALUES (?,0,?)');$q->execute([$id,$now+900]);
        $q=$this->db->prepare('UPDATE '.$this->table('attempts').' SET tries=0,expires=? WHERE id=? AND expires<?');$q->execute([$now+900,$id,$now]);
        $q=$this->db->prepare('SELECT tries FROM '.$this->table('attempts').' WHERE id=?');$q->execute([$id]);
        if ((int)$q->fetchColumn()>=10) throw new Problem('Слишком много попыток. Повторите через 15 минут.',429);
        $q=$this->db->prepare('UPDATE '.$this->table('attempts').' SET tries=tries+1 WHERE id=?');$q->execute([$id]);return $id;
    }
    public function authenticate(array $p,bool $recover=false): array {
        $login=strtolower(self::str($p['login']??'',64));$attempt=$this->throttle($login);
        $q=$this->db->prepare('SELECT * FROM '.$this->table('users').' WHERE login=?');$q->execute([$login]);$u=$q->fetch();
        $provided=$recover?($p['code']??''):($p['password']??'');
        if (!is_string($provided) || strlen($provided)>200 || !$u || !password_verify($recover?strtoupper(trim($provided)):$provided,$u[$recover?'recovery':'password'])) throw new Problem($recover?'Логин или код восстановления не подошли.':'Логин или пароль не подошли.',401);
        $out=[];
        if ($recover) {
            $code=self::recovery();$password=self::password($p['newPassword']??null);
            $q=$this->db->prepare('UPDATE '.$this->table('users').' SET password=?,recovery=?,auth_version=auth_version+1 WHERE id=? AND recovery=?');
            $q->execute([password_hash($password,PASSWORD_DEFAULT),password_hash($code,PASSWORD_DEFAULT),$u['id'],$u['recovery']]);
            if (!$q->rowCount()) throw new Problem('Код уже использован. Войдите с новым паролем.',409);
            $u['auth_version']++; $out['recoveryCodes']=[['login'=>$login,'code'=>$code]];
        }
        $q=$this->db->prepare('DELETE FROM '.$this->table('attempts').' WHERE id=?');$q->execute([$attempt]);
        session_regenerate_id(true);$_SESSION['uid']=$u['id'];$_SESSION['version']=(int)$u['auth_version'];$_SESSION['seen']=time();$_SESSION['csrf']=bin2hex(random_bytes(24));
        return $out+['user'=>['id'=>$u['id'],'login'=>$u['login'],'name'=>$u['name']],'csrf'=>$_SESSION['csrf']];
    }
    public function state(): array {
        $row=$this->db->query('SELECT revision,body FROM '.$this->table('budget').' WHERE id=1')->fetch();
        $b=json_decode($row['body'],true,512,JSON_THROW_ON_ERROR);
        return ['revision'=>(int)$row['revision'],'budget'=>$b,'summary'=>Budget::summary($b)];
    }
    public function changePassword(array $p,array $user): array {
        $this->throttle('password:'.$user['id']);
        $q=$this->db->prepare('SELECT password FROM '.$this->table('users').' WHERE id=?');$q->execute([$user['id']]);$old=$q->fetchColumn();
        if (!is_string($p['currentPassword']??null) || strlen($p['currentPassword'])>200 || !password_verify($p['currentPassword'],$old)) throw new Problem('Текущий пароль не подошёл.',401);
        $code=self::recovery();$hash=password_hash(self::password($p['newPassword']??null),PASSWORD_DEFAULT);
        $q=$this->db->prepare('UPDATE '.$this->table('users').' SET password=?,recovery=?,auth_version=auth_version+1 WHERE id=? AND password=?');$q->execute([$hash,password_hash($code,PASSWORD_DEFAULT),$user['id'],$old]);
        if (!$q->rowCount()) throw new Problem('Пароль уже изменился. Войдите заново.',409);
        $_SESSION['version']++;session_regenerate_id(true);$_SESSION['csrf']=bin2hex(random_bytes(24));
        return ['csrf'=>$_SESSION['csrf'],'recoveryCodes'=>[['login'=>$user['login'],'code'=>$code]]];
    }
    public function mutate(array $p,array $user): array {
        $key=$p['requestId']??'';if (!is_string($key) || !preg_match('/^[a-zA-Z0-9_-]{12,80}$/D',$key)) throw new Problem('Отсутствует идентификатор сохранения. Обновите страницу.');
        if (!is_int($p['revision']??null) || !is_array($p['command']??null)) throw new Problem('Проверьте формат изменения.');
        $hash=hash('sha256',self::json($p['command']));
        $this->begin();
        try {
            $row=$this->db->query('SELECT revision,body FROM '.$this->table('budget').' WHERE id=1'.($this->sqlite()?'':' FOR UPDATE'))->fetch();
            $q=$this->db->prepare('SELECT payload_hash,body FROM '.$this->table('requests').' WHERE user_id=? AND request_id=?');$q->execute([$user['id'],$key]);$previous=$q->fetch();
            if ($previous) {
                if (!hash_equals($previous['payload_hash'],$hash)) throw new Problem('Этот запрос уже использован для другого изменения.',409);
                $this->commit();return json_decode($previous['body'],true,512,JSON_THROW_ON_ERROR)+['replayed'=>true];
            }
            if ((int)$row['revision']!==$p['revision']) throw new Problem('Бюджет уже изменился. Загрузите актуальные данные и проверьте свой ввод перед повторным сохранением.',409,['conflict'=>true,'revision'=>(int)$row['revision']]);
            $before=json_decode($row['body'],true,512,JSON_THROW_ON_ERROR);$b=$before;
            if (($p['command']['type']??'')==='restore') {
                $backup=$p['command']['data']['backup']??null;$validated=Budget::backup($backup);
                if (!is_string($p['command']['data']['fingerprint']??null) || !hash_equals(hash('sha256',self::json($backup)),$p['command']['data']['fingerprint'])) throw new Problem('Предпросмотр копии устарел. Выберите файл заново.',409);
                $dir=$this->cfg['privateDir'].'/backups';if (!is_dir($dir) && !mkdir($dir,0700,true) && !is_dir($dir)) throw new RuntimeException('Backup directory');
                $file=$dir.'/before-restore-'.gmdate('Ymd-His').'-'.self::id().'.json';
                if (file_put_contents($file,self::json(['format'=>'family-budget','version'=>1,'exportedAt'=>gmdate('c'),'budget'=>$before]),LOCK_EX)===false) throw new Problem('Не удалось создать страховочную копию. Восстановление отменено.',503);
                $b=$validated;$result=['restored'=>true];
            } elseif (($p['command']['type']??'')==='importSource') {
                if (!hash_equals(Source::fingerprint(),$p['command']['data']['fingerprint']??'')) throw new Problem('Исходные данные изменились. Откройте предпросмотр заново.',409);
                $result=Source::merge($b);
            } else $result=Budget::apply($b,$p['command'],$user);
            $changes=Budget::changes($before,$b);
            if ($changes) $b['history'][]=['id'=>self::id(),'at'=>gmdate('c'),'user'=>$user['name'],'action'=>$p['command']['type'],'changes'=>$changes];
            Budget::validate($b);
            $body=self::json($b);if (strlen($body)>4500000) throw new Problem('Бюджет достиг ограничения 4,5 МБ. Скачайте резервную копию и обратитесь к администратору для расширения лимита.',413);
            $revision=(int)$row['revision']+1;
            $q=$this->db->prepare('UPDATE '.$this->table('budget').' SET revision=?,body=? WHERE id=1');$q->execute([$revision,$body]);
            $response=['revision'=>$revision,'result'=>$result];$q=$this->db->prepare('INSERT INTO '.$this->table('requests').' (user_id,request_id,payload_hash,body,created) VALUES (?,?,?,?,?)');$q->execute([$user['id'],$key,$hash,self::json($response),time()]);
            $this->commit();return $response;
        } catch (Throwable $e) { $this->rollback();throw $e; }
    }
    public function dispatch(string $action,array $p): array {
        if ($action==='session') return ['csrf'=>$_SESSION['csrf'],'user'=>$this->currentUser(false),'needsSetup'=>!$this->initialized()];
        if ($action==='setup') return $this->setup($p);
        if ($action==='login' || $action==='recover') return $this->authenticate($p,$action==='recover');
        $user=$this->currentUser();
        if ($action==='password') return $this->changePassword($p,$user);
        if ($action==='logout') { $_SESSION=[];session_destroy();setcookie(session_name(),'', ['expires'=>time()-3600,'path'=>'/','secure'=>$this->cfg['secure']??true,'httponly'=>true,'samesite'=>'Strict']);return ['ok'=>true]; }
        if ($action==='state') return $this->state();
        if ($action==='export') return ['format'=>'family-budget','version'=>1,'exportedAt'=>gmdate('c'),'revision'=>$this->state()['revision'],'budget'=>$this->state()['budget']];
        if ($action==='restorePreview') {
            $b=Budget::backup($p['backup']??null);return ['fingerprint'=>hash('sha256',self::json($p['backup'])),'entries'=>count($b['entries']),'categories'=>count($b['categories']),'summary'=>Budget::summary($b)];
        }
        if ($action==='source') { $b=$this->state()['budget'];return ['fingerprint'=>Source::fingerprint(),'preview'=>Source::merge($b)]; }
        if ($action==='mutate') { session_write_close();return $this->mutate($p,$user); }
        throw new Problem('Такое действие не найдено.',404);
    }
}
