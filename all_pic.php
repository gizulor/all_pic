<?php
if (txpinterface === 'admin') {
	new all_pic();
}

class all_pic {
protected $privs = '1,2';
protected $pluginpath = 'plugins';
protected $event = __CLASS__;

/**
 * a textpack string, or $fallback until the textpack is (re)loaded
 */
protected static function txt($key, $fallback) {
	$s = gTxt($key);
	return ($s === $key || $s === '') ? $fallback : $s;
}

/**
 * strings for the prefs panel: textpack values win; these only fill gaps.
 * TXP shows instructions_<pref name> as help text under that pref's label.
 */
public static function fallback_strings() {
	$strings = array(
		'all_pic_fields' => 'Specified fields',
		'all_pic_shortcode' => 'Gallery shortcode',
		'all_pic_shortcode_single' => 'Single image shortcode',
		'instructions_all_pic_fields' => 'Comma-separated field ids, eg. #article-image, #custom-1, #custom-3',
		'instructions_all_pic_shortcode' => 'Leave out the closing /&gt;, eg. &lt;txp::gallery ',
		'instructions_all_pic_shortcode_single' => 'Optional: used when a single image is dropped. Leave blank to use the gallery shortcode.',
	);

	$missing = array();
	foreach ($strings as $key => $text) {
		if (gTxt($key) === $key) $missing[$key] = $text;
	}

	if (!$missing || !class_exists('\Textpattern\L10n\Lang')) return;

	$lang = Txp::get('\Textpattern\L10n\Lang');
	if (method_exists($lang, 'setPack')) $lang->setPack($missing, true);
}

/**
 * settings and UI strings handed to the JS (json_encode does the escaping)
 */
public static function prefs() {
	return array(
		'thumbFields' => (string) get_pref('all_pic_fields'),
		'shortcodeBase' => (string) get_pref('all_pic_shortcode'),
		'shortcodeSingle' => (string) get_pref('all_pic_shortcode_single'),

		'addImages' => self::txt('all_pic_add_images', 'Add Images'),
		'deleteText' => self::txt('all_pic_exclude_image', 'Exclude image'),
		'editText' => self::txt('all_pic_edit_image', 'Edit image'),
		'closeText' => self::txt('all_pic_close_sideview', 'Close SideView'),
		'dropText' => self::txt('all_pic_drop_here', 'Drag images here'),
		'noteText' => self::txt('all_pic_sideview_note', 'Or drop them onto Body or Excerpt to insert a shortcode at that spot.'),
	);
}

public static function js_config() {
	$prefs = self::prefs();
	$prefs['thumb_markup'] = self::all_pic_build_thumb();

	// HEX flags: safe inside <script> even if a pref or markup contains </script> or quotes
	$json = json_encode($prefs, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES);

	echo '<script>window.allPicConfig = ' . $json . ';</script>', n;
}

/**
 * constructor
 */
public function __construct() {
	global $event, $path_to_site, $txp_permissions;

	add_privs('plugin_prefs.'.$this->event, $this->privs);
	add_privs('prefs.'.$this->event, $this->privs);

	// the all_pic event only serves thumbnails to the Write tab, so anyone who can edit
	// an article needs it (previously publishers/managing editors only)
	add_privs($this->event, isset($txp_permissions['article.edit.own']) ? $txp_permissions['article.edit.own'] : '1,2,3,4,5,6');

	// pref labels and help text, shown before the textpack has been (re)loaded;
	// runs just before the panel renders, once TXP has loaded its own strings
	register_callback(array(__CLASS__, 'fallback_strings'), 'prefs', '', 1);

	register_callback(array($this, 'adminPrefs'), 'plugin_prefs.'.$this->event);
	register_callback(array($this, 'install'), 'plugin_lifecycle.'.$this->event);

	// css is also used by the Images panel inside SideView (event=image), so loads on every admin page
	register_callback(array($this, 'all_pic_css'), 'admin_side', 'head_end');

	register_callback(array($this, 'all_pic_ajax_get_thumbs'), 'all_pic', 'get_thumbs');

	if ($event === 'article' && has_privs('article.edit.own')) {
		register_callback(array($this, 'js_config'), 'admin_side', 'body_end');
		register_callback(array($this, 'all_pic_js'), 'admin_side', 'body_end');
	}

	$this->pluginpath = str_replace($path_to_site, '..', PLUGINPATH);

	if (get_pref('all_pic_fields', null) === null)
		set_pref('all_pic_fields', '#article-image', $this->event, PREF_PLUGIN, 'longtext_input', 500, PREF_PRIVATE);
	if (get_pref('all_pic_shortcode', null) === null)
		set_pref('all_pic_shortcode', '<txp::gallery ', $this->event, PREF_PLUGIN, 'longtext_input', 700, PREF_PRIVATE);
	if (get_pref('all_pic_shortcode_single', null) === null)
		set_pref('all_pic_shortcode_single', '', $this->event, PREF_PLUGIN, 'longtext_input', 710, PREF_PRIVATE);
}

/**
 * URL of one of the plugin's own files, versioned by its modification time
 * so browsers fetch it again whenever it changes
 */
protected function asset($file) {
	$mtime = @filemtime(PLUGINPATH.'/all_pic/'.$file);
	return "$this->pluginpath/all_pic/$file".($mtime ? '?v='.$mtime : '');
}

/**
 * inject css
 */
function all_pic_css() {
	$src = $this->asset('all_pic.css');

	if (class_exists('\Textpattern\UI\Style')) {
		echo Txp::get('\Textpattern\UI\Style')->setSource($src), n;
	} else {
		echo n.'<link rel="stylesheet" media="screen" href="'.txpspecialchars($src).'">', n;
	}
}

/**
 * inject the js
 */
function all_pic_js() {
	$src = $this->asset('all_pic.js');

	if (class_exists('\Textpattern\UI\Script')) {
		echo Txp::get('\Textpattern\UI\Script')->setRoute(array('article'))->setSource($src), n;
	} else {
		echo n.'<script defer src="'.txpspecialchars($src).'"></script>', n;
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
 * the configured field selectors as textpattern column names
 * (#article-image => Image, #custom-3 => custom_3); anything else is ignored
 */
protected static function field_columns() {
	$columns = array();

	foreach (do_list(get_pref('all_pic_fields')) as $selector) {
		if ($selector === '#article-image') {
			$columns[] = 'Image';
		} elseif (preg_match('/^#custom-(\d+)$/', $selector, $m)) {
			$columns[] = 'custom_'.$m[1];
		}
	}

	return array_unique($columns);
}

/**
 * thumbnails for every image id in the configured fields of the article being edited
 */
public static function all_pic_build_thumb() {
	global $step;

	$columns = self::field_columns();
	$article_id = intval(gps('ID'));
	$values = array();

	if (!$columns) return '';

	if ($step == 'edit' && $article_id) {
		$row = safe_row(implode(',', $columns), 'textpattern', 'ID = '.$article_id);
		if ($row) $values = array_values($row);
	} elseif ($step == 'create' || $step == 'edit') {
		// form re-displayed after a failed save: take the posted values
		foreach ($columns as $column) {
			$values[] = gps($column);
		}
	}

	$ids = array();

	foreach (do_list(implode(',', $values)) as $id) {
		if (ctype_digit($id)) $ids[] = $id;
	}

	return self::all_pic_render_thumbs($ids);
}

/**
 * thumbnail <li> markup for a list of image ids
 */
public static function all_pic_render_thumbs(array $ids = array()) {
	$ids = array_unique(array_filter(array_map('intval', $ids)));
	if (!$ids) return '';

	$prefs = self::prefs();
	$edit = txpspecialchars($prefs['editText']);
	$exclude = txpspecialchars($prefs['deleteText']);

	$image_url = (defined('ihu') ? ihu : hu).get_pref('img_dir');
	$image_dir = defined('IMPATH') ? IMPATH : '';

	$rs = safe_rows('ext,id,thumbnail', 'txp_image', 'id IN ('.implode(',', $ids).')');
	$markup = array();

	foreach ((array) $rs as $a) {
		$id = intval($a['id']);
		$file = $id.($a['thumbnail'] ? 't' : '').$a['ext'];

		// version by the file's modification time: cached normally, refreshed when a thumb is rebuilt
		$mtime = $image_dir ? @filemtime($image_dir.$file) : false;
		$src = $image_url.'/'.$file.'?'.($mtime ? $mtime : time());

		$markup[] =
			'<li class="all_pics__item" data-id="'.$id.'">'.
			'<img title="Drag ('.$id.') to relocate" src="'.txpspecialchars($src).'" alt="" />'.
			'<p>'.
			'<span class="all_pics__icon"><a class="ui-icon ui-icon-pencil all_pics__edit" href="#" title="'.$edit.'">'.$edit.'</a></span>'.
			'<span class="all_pics__icon"><a class="ui-icon ui-icon-close all_pics__delete" href="#" title="'.$exclude.'">'.$exclude.'</a></span>'.
			'</p>'.
			'</li>';
	}

	return implode('', $markup);
}

/**
 * async: thumbnails for ids typed, pasted or dropped into a field
 */
public function all_pic_ajax_get_thumbs() {
	if (!has_privs('article.edit.own')) exit;

	echo self::all_pic_render_thumbs(do_list(gps('ids')));
	exit;
}
}
