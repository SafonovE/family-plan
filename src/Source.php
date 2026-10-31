<?php
declare(strict_types=1);

final class Source {
    public static function file(): string { return dirname(__DIR__).'/private/source.json'; }
    public static function fingerprint(): string { if (!is_file(self::file())) throw new Problem('Снимок таблицы не установлен. Используйте JSON-копию или ручной ввод.',404); return hash_file('sha256',self::file()); }
    private static function norm(string $s): string {
        $s=strtr(trim($s),array_combine(preg_split('//u','АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',-1,PREG_SPLIT_NO_EMPTY),preg_split('//u','абвгдеёжзийклмнопрстуфхцчшщъыьэюя',-1,PREG_SPLIT_NO_EMPTY)));
        return preg_replace('/[\s.]+/u','',$s);
    }
    private static function money(mixed $v): int {
        if ((!is_int($v) && !is_float($v)) || $v<0 || abs($v*100-round($v*100))>0.000001) throw new Problem('В исходной таблице найдена неподдерживаемая сумма. Импорт остановлен.');
        return Budget::amount((int)round($v*100));
    }
    public static function merge(array &$b): array {
        if (!is_file(self::file())) throw new Problem('Исходный файл ещё не установлен на сервере.',404);
        $s=json_decode(file_get_contents(self::file()),true,100,JSON_THROW_ON_ERROR);
        $preview=['months'=>[],'entries'=>0,'plans'=>0,'templates'=>0,'added'=>0,'skipped'=>0,'warnings'=>[
            'В месячных листах нет доходов и начального остатка. Фактический остаток денег пока не определён.',
            'Дни расходов неизвестны: сохранён только месяц. Меню свадьбы и жизненные задачи исключены.',
            '«Лист1» станет обычными суммами для планирования, без повторного добавления фактических операций.',
            'План свадьбы в таблице не указан: формула считает расходы. Он останется незаполненным.',
        ]];
        $importCategories=[];$preview['usual']=['income'=>0,'expense'=>0,'targetExpense'=>0];
        $catMap=[];foreach ($b['categories'] as $id=>$cat) { $catMap[$cat['kind'].'|'.self::norm($cat['name'])]??=$id;foreach ($cat['sourceNames']??[] as $alias) $catMap[$alias]??=$id; }
        $category=function(string $name,string $kind='expense') use (&$b,&$catMap,&$importCategories): string {
            $name=trim($name);$key=$kind.'|'.self::norm($name);
            if (!isset($catMap[$key])) { $id=App::id();$b['categories'][$id]=['id'=>$id,'name'=>$name,'kind'=>$kind,'order'=>count($b['categories']),'archived'=>false];$catMap[$key]=$id; }
            $id=$catMap[$key];if (!in_array($key,$b['categories'][$id]['sourceNames']??[],true)) $b['categories'][$id]['sourceNames'][]=$key;
            $importCategories[$key]=['name'=>$name,'kind'=>$kind];return $id;
        };
        $seen=$b['imports'];foreach (['entries','plans','templates'] as $collection) foreach ($b[$collection] as $r) if (isset($r['sourceKey'])) $seen[$r['sourceKey']]=true;
        $put=function(string $collection,string $key,array $record,?string $id=null) use (&$b,&$seen,&$preview,$s):void {
            $preview[$collection]++;$sourceKey=$s['spreadsheetId'].'/'.$key;
            $b['imports'][$sourceKey]=true;
            if (isset($seen[$sourceKey]) || ($id!==null && isset($b[$collection][$id]))) { $preview['skipped']++;return; }
            $id??=App::id();$b[$collection][$id]=$record+['id'=>$id,'sourceKey'=>$sourceKey,'sourceRef'=>$key];$seen[$sourceKey]=true;$preview['added']++;
        };
        foreach ($s['months'] as $m) {
            $month=Budget::month($m['month']);$preview['months'][$month]=['income'=>0,'expense'=>0,'plannedExpense'=>0,'count'=>0];
            foreach ($m['formulas'] as $c=>$formula) {
                $cat=$category($m['values'][0][$c]);$letter=chr(65+$c);$sum=0;
                foreach (array_slice($m['values'],2,null,true) as $r=>$row) if (isset($row[$c]) && $row[$c]!=='') {
                    $amount=self::money($row[$c]);if ($amount===0) continue;$sum+=$amount;
                    $description=$c===count($m['formulas'])-1?trim((string)($row[$c+1]??'')):'';
                    $put('entries',$m['sheet'].'!'.$letter.($r+1),['month'=>$month,'date'=>null,'categoryId'=>$cat,'amount'=>$amount,'description'=>$description]);$preview['months'][$month]['count']++;
                }
                $preview['months'][$month]['expense']+=$sum;
                if (preg_match('/^=(\d+(?:\.\d+)?)-SUM\([A-Z]+3:[A-Z]+120\)$/D',$formula,$match)) {
                    $amount=self::money((float)$match[1]);
                    if ((int)round($m['values'][1][$c]*100)!==$amount-$sum) throw new Problem('Итог исходной таблицы не сходится: '.$m['sheet'].'!'.$letter.'2.');
                    $put('plans',$m['sheet'].'!'.$letter.'2',['month'=>$month,'categoryId'=>$cat,'amount'=>$amount],$month.'_'.$cat);$preview['months'][$month]['plannedExpense']+=$amount;
                } elseif ($formula==='=SUM('.$letter.'3:'.$letter.'120)') {
                    if ((int)round($m['values'][1][$c]*100)!==$sum) throw new Problem('Не сходится итог расходов на свадьбу.');
                } else throw new Problem('Неподдерживаемая формула плана. Импорт остановлен.');
            }
        }
        foreach (array_slice($s['usual']['values'],1,null,true) as $r=>$row) {
            if (isset($row[1]) && $row[1]!=='') { $cat=$category(trim((string)($row[0]??''))?:'Доход без названия · строка '.($r+1),'income');$put('templates',$s['usual']['sheet'].'!B'.($r+1),['categoryId'=>$cat,'amount'=>self::money($row[1]),'targetAmount'=>null,'description'=>'Обычная сумма за месяц']); }
            if (isset($row[3]) && $row[3]!=='') { $cat=$category((string)$row[2]);$put('templates',$s['usual']['sheet'].'!D'.($r+1),['categoryId'=>$cat,'amount'=>self::money($row[3]),'targetAmount'=>isset($row[4])?self::money($row[4]):null,'description'=>'Обычная сумма за месяц']); }
        }
        foreach (array_slice($s['usual']['values'],1) as $row) { if (isset($row[1])) $preview['usual']['income']+=self::money($row[1]);if (isset($row[3])) $preview['usual']['expense']+=self::money($row[3]);if (isset($row[4])) $preview['usual']['targetExpense']+=self::money($row[4]); }
        $preview['categories']=array_values($importCategories);return $preview;
    }
}
