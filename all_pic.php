<?php
if (txpinterface === 'admin') {
	new all_pic();
}

class all_pic {
protected $privs = '1,2';
protected $pluginpath = 'plugins';
protected $event = __CLASS__;

public static function prefs() {
	return array(
		'thumbFields' => escape_js(get_pref('all_pic_fields')),
		'shortcodeBase' => escape_js(get_pref('all_pic_shortcode')),

		'addImages' => 'Add Images',
		'deleteText' => 'Exclude image',
		'editText' => 'Edit image',
		'closeText' => 'Close SideView',
	);
}

public static function js_config() {
	$prefs = self::prefs();
	$prefs['thumb_markup'] = self::all_pic_build_thumb();

	echo '<script>';
	echo 'window.allPicConfig = ' . json_encode($prefs) . ';';
	echo '</script>';
}

/**
 * constructor
 */
public function __construct() {
	global $event, $step, $path_to_site;

	add_privs('plugin_prefs.'.$this->event, $this->privs);
	add_privs($this->event, $this->privs);
	add_privs('prefs.'.$this->event, $this->privs);

	register_callback(array($this, 'adminPrefs'), 'plugin_prefs.'.$this->event);
	register_callback(array($this, 'install'), 'plugin_lifecycle.'.$this->event);

	// css is also used to modify the prefs panel, so loads on every admin page
	register_callback(array($this, 'all_pic_css'), 'admin_side', 'head_end');

	register_callback(array($this, 'all_pic_ajax_get_thumbs'), 'all_pic', 'get_thumbs');

	if ($event === 'article' && has_privs('article.edit.own')) {
		register_callback(array($this, 'js_config'), 'admin_side', 'body_end');
		register_callback(array($this, 'all_pic_js'), 'admin_side', 'body_end');
		register_callback(array($this, 'all_pic_build_thumb'), 'admin_side', 'body_end');
		register_callback(array($this, 'all_pic_render_thumbs'), 'admin_side', 'article');
	}

	$this->pluginpath = str_replace($path_to_site, '..', PLUGINPATH);
	if (get_pref('all_pic_fields', null) === null)
		set_pref('all_pic_fields', '#article-image', $this->event, PREF_PLUGIN, 'longtext_input', 500, PREF_PRIVATE);
	if (get_pref('all_pic_shortcode', null) === null)
		set_pref('all_pic_shortcode', '<txp::gallery ', $this->event, PREF_PLUGIN, 'longtext_input', 700, PREF_PRIVATE);

}

/**
 * inject css
 *
 * @return string CSS style link
 */
function all_pic_css() {

	if (class_exists('\Textpattern\UI\Style')) {
		echo Txp::get('\Textpattern\UI\Style')->setSource("$this->pluginpath/all_pic/all_pic.css"), n;
	} else {
		echo n, <<<EOCSS
		<link rel="stylesheet" media="screen" href="$this->pluginpath/all_pic/all_pic.css">
		EOCSS;
	}
}

/**
 * inject the js
 *
 * @return string HTML &lt;script&gt; tag
 */
function all_pic_js() {
	if (class_exists('\Textpattern\UI\Script')) {
		echo Txp::get('\Textpattern\UI\Script')->setRoute(array('article'))->setSource("$this->pluginpath/all_pic/all_pic.js"), n;
	} else {
		echo n.'<script defer src="'.$this->pluginpath.'/all_pic/all_pic.js"></script>';
	}
}

/**
 * installs prefs if not already defined
 *
 * @param string $evt Admin-side event
 * @param string $stp Admin-side step
 */
public function install($evt = '', $stp = '') {
	if ($stp == 'deleted') {
		safe_delete('txp_prefs', "name LIKE 'all\_pic\_%'");
		safe_delete('txp_lang', "name = 'instructions\_article\_image\_select'");
	} elseif ($stp == 'installed') {
		safe_update('txp_prefs', "event='".$this->event."'", "name LIKE 'all\_pic\_%'");

		if (get_pref('all_pic_limit', null) !== null)
				safe_delete('txp_prefs', "name='all\_pic\_limit'");
	}
}

/**
 * redirect to the preferences panel
 */
public function adminPrefs() {
		header('Location: ?event=prefs#prefs_group_all_pic');
		echo
				'<p id="message">'.n.
				'   <a href="?event=prefs#prefs_group_all_pic">'.gTxt('continue').'</a>'.n.
				'</p>';
}

/**
 * determine field inputs
 * prepare thumbnail ids
 */
public static function all_pic_build_thumb() {
	$prefs = all_pic::prefs();
	global $step;
	//global $prefs, $step;
	extract($prefs);

	$article_id = gps('ID');
	$fields_array = explode(",", $thumbFields);
	for ($i = 0; $i < count($fields_array); $i++) {
		$current_field = trim($fields_array[$i]);
		$current_field = ($current_field === '#article-image') ? 'Image' : str_replace('#custom-', 'custom_', $current_field);
		$fields_array[$i] = $current_field;
	}

	if ($step == 'edit' && $article_id) {
		$fields_string = implode(',', $fields_array);
		$values = safe_row($fields_string, 'textpattern', 'ID = '. $article_id);
	}
	elseif ($step == 'create' || $step == 'edit') {
		for ($i = 0; $i < count($fields_array); $i++) {
			$current = $fields_array[$i];
			$values[] = gps($current);
		}
	}

	$values = array_filter(array_values($values));
	$values = explode(',', implode(',', $values));

	$ids = [];

	foreach ($values as $group) {
		if (!empty($group) && is_numeric($group)) {
			$ids[] = trim($group);
		}
	}
	return self::all_pic_render_thumbs($ids); // static call to method
}

/**
 * prepare thumbnails html
 */
public static function all_pic_render_thumbs(array $ids = []) {
	$image_path = hu . get_pref('img_dir');
	$prefs = all_pic::prefs();
	$markup = [];

	$ids = array_filter($ids, 'is_numeric');
	if (empty($ids)) return '';

	$escaped = implode(',', array_map('intval', $ids));
	$rs = safe_rows('ext,id,thumbnail', 'txp_image', 'id IN (' . $escaped . ')');

	if ($rs) {
		$rnd_number = '?' . time();

		foreach ($rs as $a) {
			extract($a);
			$image = ($thumbnail == 0) ? $id . $ext . $rnd_number : $id . 't' . $ext . $rnd_number;

			$markup[] =
				'<li class="all_pics__item" data-id="' . $id . '">' .
				'<img title="Drag to reorder" src="' . $image_path . '/' . $image . '" alt="" />' .
				'<p>' .
				'<span class="all_pics__icon"><a class="ui-icon ui-icon-pencil all_pics__edit" href="#" title="' . $prefs['editText'] . '">' . $prefs['editText'] . '</a></span>' .
				'<span class="all_pics__icon"><a class="ui-icon ui-icon-close all_pics__delete" href="#" title="' . $prefs['deleteText'] . '">' . $prefs['deleteText'] . '</a></span>' .
				'</p>' .
				'</li>';
		}
	}
	return implode('', $markup);
}

/**
 * called by a direct user-input change to a field
 */
public  function all_pic_ajax_get_thumbs() {

	$ids = gps('ids');
	$idArray = array_filter(array_map('trim', explode(',', $ids)));

	echo self::all_pic_render_thumbs($idArray);
	exit;

	}
}
