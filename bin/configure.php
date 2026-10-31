<?php
declare(strict_types=1);
if (PHP_SAPI!=='cli') { http_response_code(404);exit; }
$root=dirname(__DIR__);$file=$root.'/private/config.php';$mode=$argv[1]??'';
if ($mode==='--setup-fragment') {
    if (!is_file($file)) exit(1);
    $config=require $file;echo '#setup='.rawurlencode($config['installKey']);exit;
}
if ($mode==='--check') {
    if (!is_file($file)) { fwrite(STDERR,"Configuration is missing.\n");exit(1); }
    $c=require $file;
    try { $pdo=new PDO($c['dsn'],$c['dbUser']??'',$c['dbPassword']??'',[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);$pdo->query('SELECT 1');echo 'PHP '.PHP_VERSION.'; database connection OK; driver '.$pdo->getAttribute(PDO::ATTR_DRIVER_NAME).PHP_EOL; }
    catch (Throwable) { fwrite(STDERR,"Database connection failed. Check private/config.php.\n");exit(1); }exit;
}
if (!in_array($mode,['--local','--mysql'],true)) { echo "Usage: php bin/configure.php --local | --mysql | --check | --setup-fragment\n";exit(1); }
if (is_file($file)) { echo "Existing configuration preserved.\n";exit; }
umask(0077);$private=$root.'/private';if (!is_dir($private)) mkdir($private,0700,true);
$config=['dsn'=>'sqlite:'.$private.'/family.sqlite','dbUser'=>'','dbPassword'=>'','installKey'=>bin2hex(random_bytes(32)),'secure'=>false,'privateDir'=>$private,'tablePrefix'=>'family_'];
if ($mode==='--mysql') {
    foreach (['FAMILY_DB_HOST','FAMILY_DB_NAME','FAMILY_DB_USER','FAMILY_DB_PASSWORD'] as $key) if (getenv($key)===false || getenv($key)==='') { fwrite(STDERR,"Set the four FAMILY_DB_ variables in your private server session. No credentials are printed.\n");exit(1); }
    $host=getenv('FAMILY_DB_HOST');$name=getenv('FAMILY_DB_NAME');
    if (!preg_match('/^[a-zA-Z0-9_.-]+$/D',$host) || !preg_match('/^[a-zA-Z0-9_-]+$/D',$name)) { fwrite(STDERR,"Unsupported database host/name.\n");exit(1); }
    $config['dsn']='mysql:host='.$host.';dbname='.$name.';charset=utf8mb4';$config['dbUser']=getenv('FAMILY_DB_USER');$config['dbPassword']=getenv('FAMILY_DB_PASSWORD');$config['secure']=true;
}
if (file_put_contents($file,"<?php\n// Keep outside the web root.\nreturn ".var_export($config,true).";\n",LOCK_EX)===false) exit(1);
@chmod($file,0600);echo "Configuration created. Credentials remain in private/config.php.\n";
