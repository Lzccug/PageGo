import * as React from 'react';
import * as ReactDOM from 'react-dom';
import APP from './app';
import './polyfill/Object-assign';

export default (function () {
  'use strict';
  const fragment = document.createDocumentFragment();
  // 创建容器和保护层，并统一添加至body
  const preventClickPop = document.createElement('div'),
    screenPage = document.createElement('div');
  preventClickPop.setAttribute('class', 'pagego-preventClickPop');
  screenPage.setAttribute('class', 'pagego-screenPage');
  fragment.appendChild(screenPage);
  fragment.appendChild(preventClickPop);
  document.body.appendChild(fragment);

  const noHistoryState = !window.history.replaceState;
  let initUrlStateFlag = true;
  // pageList 是打包时注册的各页面的异步路由集合
  let pageList:any[];
  let popHashArr = [], preLoadArr = [];
  // hash路由在url中的#后面标记页面，但是整体还是走pushstate
  // 默认使用hash标记路由
  let hashRouter =  true;
  // 全局props
  let globalProps;
  // base url
  let baseurl = '';
  // redux模式, 默认没有
  let reduxMode = false;
  let Connector, Provider, store;
  // 首次加载页面标志用于首次加载需要重新replace
  let nowIndex = 0, nowPath:string, fromDirection:string;
  let app;
  // 在主页用域名，子页用具体地址时使用，该值为域名和项目名间的中间值
  let MidPathWhenOnlyDomain;
  // 是否是手势返回
  let swipeback = false;
  // 默认Context值
  let initContext = null

  return {
    init: function(param): Promise<void> {
      if (param && param.pageWillSwitch) this.pageWillSwitch = param.pageWillSwitch;
      if (param && param.pageDidSwitch) this.pageDidSwitch = param.pageDidSwitch;

      initContext = param.initContext
      // 如果手动设置了baseurl
      if (param.baseUrlWithoutProtocol) {
        baseurl = location.protocol + '//' + param.baseUrlWithoutProtocol;
        baseurl = baseurl.endsWith('/') ? (baseurl + '/') : baseurl;
      }

      if(param.MidPathWhenOnlyDomain) {
        MidPathWhenOnlyDomain = param.MidPathWhenOnlyDomain
      }

      // 全局非redux的props
      if (param.globalProps) {
        globalProps = param.globalProps
      }
      // 有页面列表
      if (param.pageList) {
        pageList = param.pageList
      } else {
        throw('需要初始化的pageList配置文件')
      }
      // 若设置不使用hash路由，设置hashRouter为false
      if (param.noHashRouter) {
        hashRouter = false
      }
      let hasConnector = !!param.Connector,
        hasProvider = !!param.Provider,
        hasStore = !!param.store;
      if (hasConnector && hasProvider && hasStore) {
        // 所以redux所需参数完备，调整为rdeux模式
        reduxMode = true;
        Connector = param.Connector;
        Provider = param.Provider;
        store = param.store;
      } else if (hasConnector || hasProvider || hasStore) {
        // 不具备redux所有完备参数，抛错
        throw('redux模式需要Connector, Provider及store')
      }

      window.addEventListener('popstate', evt=>{
        if (evt.state) {
          this.renderHistoryPage(evt.state);
        }
      }, false);

      screenPage.style.height = window.innerHeight + 'px';

      return Promise.resolve();
    },

    preLoad: function(pagepath){
      if (pagepath) {
        let pathArr;
        if (typeof pagepath == 'string') {
          pathArr = [pagepath]
        } else {
          pathArr = pagepath;
        }
        const pathLen = pathArr.length;
        for (let i = 0; i < pathLen; i++) {
          // preLoadArr是已经预加载的列表，未预加载的才加载
          if (preLoadArr.indexOf(pathArr[i]) < 0) {
            pageList[pathArr[i]]();
            preLoadArr.push(pathArr[i]);
          }
        }
      }
    },

    next: function(page: string, pageData?, callback?){
      this.go(page, 'next', pageData, callback)
    },

    hover: function(page: string, pageData?, callback?){
      this.go(page, 'next-hover', pageData, callback)
    },

    jump: function(page: string, pageData?, callback?){
      this.go(page, 'current', pageData, callback)
    },

    go: function(page: string, direction?, pageData?, callback?, historyGo?, replace?){
      let pagepath = page;
      // 当使用hash路由时
      // 首次进入判断是否是刷新
      if (initUrlStateFlag) {
        const hashstring = window.location.hash;
        if (hashstring) {
          let hash = hashstring.split('#')[1];
          if (!!pageList[hash]) {
            pagepath = hash;
          }
        }
      }
      
      const pageFunc = pageList[pagepath];
      const render = (page) => {
        this.renderGo(page, {
          pageName: pagepath,
          direction: direction
        }, pageData, historyGo, replace);
        callback && callback();
      }
      // 同步页面
      if (pageFunc.defaultProps || pageFunc.hookPage) {
        render(pageFunc);
      } else {
        // 根据路由动态加载页面js
        pageList[pagepath]().then(page => {
          render(page);
        })
      }
    },

    // 获取到要滑动至的页面，并进行位置设置
    renderGo: function(currentpage, pageAttribute, pageData?, historyGo?, replace?) {
      const isHookPage = !!currentpage.hookPage;
      const defaultProps = currentpage.defaultProps || currentpage.hookPage,
        preLoad = defaultProps.PreLoad;
      const direction = pageAttribute.direction || 'next';
      const PageName = (pageData ? pageData.PageName : '') || pageAttribute.pageName,
        PageTitle = (pageData ? pageData.PageTitle : '') || defaultProps.PageTitle,
        PageSwipeBack = (pageData ? pageData.PageSwipeBack : null) || defaultProps.PageSwipeBack || false
      // 将globalProps赋值给当前页面的数据，并且pageData优先
      let renderPageData = Object.assign({}, globalProps, pageData);

      // 若有注册页面开始回调事件，执行
      this.pageWillSwitch && this.pageWillSwitch({
        pageName: PageName,
        pageTitle: PageTitle,
        pageData: pageData
      });

      // 若有注册页面切换成功回调事件，执行
      const callDidSwitch = () => {
        this.pageDidSwitch && this.pageDidSwitch({
          pageName: PageName,
          pageTitle: PageTitle,
          pageData: renderPageData
        })
      }

      // 根据是否是浏览器的前进后退操作确定正常到达当前页面的页面方向
      // 此页面方向提供给下一次浏览器操作时所用
      if (historyGo) {
        fromDirection = window.history.state.direction;
      } else {
        fromDirection = direction;
      }

      if (direction === 'next' || direction === 'back') {
        if (!initUrlStateFlag) preventClickPop.style.display = 'block';
      } else if (direction === 'top' || direction === 'bottom'|| direction === 'next-hover') {
        // 展开保护层
        preventClickPop.style.display = 'block';
        setTimeout(function(){
          preventClickPop.style.display = 'none';
        }, 350)
        popHashArr.push(nowPath);
      }

      nowPath = PageName.toLowerCase();
      document.title = PageTitle || '';

      if (!this.entryPageName) this.entryPageName = nowPath;

      // 非历史路由需要设置前往路径及pushstate
      if (!historyGo) {
        // 非历史路由不包含back类型
        const pushUrl = hashRouter ? this.getHashPushUrl(defaultProps, pageData) :  this.getPushUrl(defaultProps, pageData);
        // 如果是首次加载(包括刷新等)
        if (initUrlStateFlag) {
          const pgState = window.history.state;
          if (pgState && pgState.hasOwnProperty('index')) {
            nowIndex = pgState.index;
          }
          // 若是刷新页面时，使用之前保留的数据
          if (pgState && pgState.pageData) {
            pageData = renderPageData = pgState.pageData;
          }
        }

        const pageInfo = {
          name: nowPath,
          index: nowIndex,
          direction: direction,
          isHookPage: isHookPage,
          // pushState及replaceState 是不允许存入function的
          // 通过这种方式去除function
          // 因此，跨页面传参时不要传入函数，因为这些函数很可能会失效
          pageData: pageData ? JSON.parse(JSON.stringify(pageData)) : null
        }

        // 若不支持pushState，pushUrl已在getPushUrl方法中添加了传参
        if(noHistoryState && !initUrlStateFlag) {
          window.location.href = pushUrl;
        } else {
          if (replace || initUrlStateFlag) {
            window.history.replaceState(pageInfo, null, pushUrl)
          } else {
            pageInfo.index = nowIndex = (nowIndex + 1);
            window.history.pushState(pageInfo, null, pushUrl)
          }
        }
      }

      // 使用react渲染页面
      if (initUrlStateFlag) {
        initUrlStateFlag = false;
        const ctRef:any = React.createRef();
        let appProps = {
          ref: ctRef,
          currentpage: currentpage,
          PageName: PageName,
          index: nowIndex,
          renderPageData: renderPageData,
          preventClickPop: preventClickPop,
          reduxMode: reduxMode,
          isHookPage: isHookPage,
          back: this.back,
          initContext: initContext,
          PageSwipeBack: PageSwipeBack
        }
        ReactDOM.render(
          reduxMode
          ? <Provider store={ store }>
              <APP {...appProps} Connector = { Connector }  />
            </Provider>
          : <APP {...appProps} />
          , screenPage, ()=>{
              app = ctRef.current;
              callDidSwitch();
              // 如果有预加载项，则预加载
              preLoad && this.preLoad(preLoad);
          })
      } else {
        app.renderPage({
          currentpage: currentpage,
          PageName: PageName,
          renderPageData: renderPageData,
          index: nowIndex,
          direction: direction,
          history: historyGo,
          // 非redux模式值为空
          Connector: Connector,
          reduxMode: reduxMode,
          isHookPage: isHookPage,
          initContext: initContext,
          PageSwipeBack: PageSwipeBack
        }, ()=>{
          // 若有注册页面切换成功回调事件，执行
          this.pageDidSwitch && setTimeout(callDidSwitch, 350);
          // 如果有预加载项，则预加载
          preLoad && this.preLoad(preLoad);
        });
      }
    },

    getHashPushUrl: function(defaultProps, pageData){
      const prefixUrl = location.origin + location.pathname;
      let pushUrl = '', search = location.search, appendSearch = '';

      // 有加url参数的进行变更
      if (pageData && pageData.PushUrlParam) {
        appendSearch = this.getAppendParamUrl(pageData.PushUrlParam);
        // 老版本不能兼容pushState, 通过url传递Props
        if (noHistoryState && pushUrl.indexOf('passprops')<0) {
          const passProps = ('passprops=' + encodeURIComponent(JSON.stringify(pageData)));
          appendSearch = appendSearch + '&' + passProps;
        }

        // 当未设置CleanUrl时将search传递下去
        if (!pageData.CleanUrl) {
          appendSearch = (search ? (search + '&') : '?') + appendSearch;
        } else {
          appendSearch = '?' + appendSearch
        }
      } else if (!pageData || !pageData.CleanUrl) {
        // 当未设置CleanUrl时将search传递下去
        appendSearch = search;
      }

      pushUrl = prefixUrl + appendSearch + '#' + nowPath

      return pushUrl

    },

    getPushUrl: function(defaultProps, pageData){
      const preUrl = location.origin + location.pathname;
      const hash = location.hash, search = location.search;
      const suffixPath = nowPath + '.html';
      let pushUrl = '';

      // 获取基础url
      if (!baseurl && initUrlStateFlag) {
        if (preUrl.endsWith(suffixPath)) {
          baseurl = preUrl.replace(suffixPath, '')
        } else {
          baseurl = preUrl;
        }
      }
      // 只能将index页面映射成域名
      if (window.location.pathname === '/' && nowPath === 'index') {
        // 如https://m.xxx.com/ 的形态情况下处理
        pushUrl = preUrl;
      } else {
        if (MidPathWhenOnlyDomain) {
          pushUrl = baseurl + MidPathWhenOnlyDomain + suffixPath;
        } else {
          // 默认url
          pushUrl = baseurl + suffixPath;
        }
      }
      
      // 当未设置CleanUrl时将hash和search传递下去
      if (!pageData || !pageData.CleanUrl) {
        pushUrl = pushUrl + search + hash;
      }

      // 若有设置使用URL参数
      if (pageData && pageData.PushUrlParam) {
        const appendUrl = this.getAppendParamUrl(pageData.PushUrlParam);
        if (initUrlStateFlag) {
          pushUrl = (pushUrl + (pushUrl.indexOf('?') > 0 ? '&' : '?') + appendUrl);
        } else {
          pushUrl = pushUrl.split('?')[0] + '?' + appendUrl;
        }
      }

      // 兼容不支持history.state的设备
      if (noHistoryState && pageData && pushUrl.indexOf('passprops')<0) {
        const passProps = ('passprops=' + encodeURIComponent(JSON.stringify(pageData)));
        pushUrl = (pushUrl + (pushUrl.indexOf('?') > 0 ? '&' : '?') + passProps);
      }

      return pushUrl
    },

    getAppendParamUrl: function(param){
      let appendArr = [];
      for (var key in param) {
        if (typeof(param[key]) == 'object') {
          appendArr.push(key + '=' + JSON.stringify(param[key]))
        } else {
          appendArr.push(key + '=' + param[key])
        }
      }
      return appendArr.join('&')
    },
    // 类似于window.location.replace方法
    replace: function(pagepath, direction, pageData, callback?) {
      this.go(pagepath, direction, pageData, callback, null, true)
    },
    back: function(num, touchback?) {
      window.history.go(num || -1);
      swipeback = !!touchback;
    },
    jumpOut: false,
    renderHistoryPage: function(pageInfo) {
      // ios safari返回可能会存在direction为空值的情况
      if (pageInfo.direction == null && this.jumpOut) {
        this.jumpOut = false;
        return;
      }

      var pageName = pageInfo.name,
        thisIndex = pageInfo.index,
        dvalue = nowIndex - thisIndex;
      // 浏览器后退
      if (dvalue > 0) {
        if (fromDirection === 'current' || fromDirection === 'next') {
          this.go(pageName, fromDirection === 'current' ? 'current' : 'back', pageInfo.pageData, null, true)
        } else if (fromDirection === 'top' || fromDirection === 'bottom' || fromDirection === 'next-hover'){
          !swipeback && app.hoverBack(dvalue);
          var popArr = popHashArr.splice(-dvalue, dvalue);
          nowPath = popArr[0];
          fromDirection = pageInfo.direction;
        } else {
          console.error('路由出错了')
        }
        swipeback = false
        // 否则前进
      } else {
        this.go(pageName, pageInfo.direction, pageInfo.pageData, null, true);
      }
      nowIndex = thisIndex;
    }
  };
})();